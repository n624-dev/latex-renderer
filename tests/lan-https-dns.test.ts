import { describe, expect, it, vi } from "vitest";
import { createSocket } from "node:dgram";
import { connect } from "node:net";
import { once } from "node:events";
import {
  createLanHttpsDnsResponder,
  startLanHttpsDnsServer,
} from "../deploy/lan-https/dns.mjs";

const domain = "lan.example.test";
function query(name: string, type = 1) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(1234);
  head.writeUInt16BE(0x0100, 2);
  head.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(5);
  tail.writeUInt16BE(type, 1);
  tail.writeUInt16BE(1, 3);
  return Buffer.concat([
    head,
    ...name
      .split(".")
      .map((label) =>
        Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]),
      ),
    tail,
  ]);
}
function responder(
  challengeValues = vi.fn<(name: string) => readonly string[]>(() => []),
) {
  return createLanHttpsDnsResponder({
    domain,
    nameserver: "ns1.example.test",
    challengeValues,
  });
}
function answer(name: string, type = 1) {
  const reply = responder()(query(name, type));
  if (!reply) throw new Error("Expected DNS reply");
  return reply;
}

describe("authoritative stateless LAN DNS", () => {
  it("answers private IP-derived A and AAAA names without accessing the database", () => {
    const values = vi.fn(() => {
      throw new Error("DB unavailable");
    });
    const respond = responder(values);
    const v4 = respond(query(`192-168-1-50.${domain}`));
    expect(v4?.readUInt16BE(0)).toBe(1234);
    expect(v4?.readUInt16BE(2)).toBe(0x8500);
    expect(v4?.readUInt16BE(6)).toBe(1);
    expect(v4?.subarray(-4)).toEqual(Buffer.from([192, 168, 1, 50]));
    const v6 = respond(
      query(`fd12-0000-0000-0000-0000-0000-0000-0001.${domain}`, 28),
    );
    expect(v6?.readUInt16BE(6)).toBe(1);
    expect(v6?.subarray(-16).toString("hex")).toBe(
      "fd120000000000000000000000000001",
    );
    expect(values).not.toHaveBeenCalled();
  });
  it("returns authority NS, SOA and CAA for the zone and NODATA for a different record family", () => {
    for (const [type, count] of [
      [2, 1],
      [6, 1],
      [257, 4],
    ]) {
      const result = answer(domain, type);
      expect(result.readUInt16BE(6)).toBe(count);
      expect(result.readUInt16BE(2) & 15).toBe(0);
    }
    const nodata = answer(`192-168-1-50.${domain}`, 28);
    expect(nodata.readUInt16BE(6)).toBe(0);
    expect(nodata.readUInt16BE(8)).toBe(1);
    expect(nodata.readUInt16BE(2) & 15).toBe(0);
  });
  it.each([
    "example.test",
    "192-168-1-50.lan.example.test.evil.test",
    "192-168-1-50.evillan.example.test",
  ])("refuses out-of-zone question %s without recursion", (name) => {
    const reply = answer(name);
    expect(reply.readUInt16BE(2) & 15).toBe(5);
    expect(reply.readUInt16BE(2) & 0x80).toBe(0);
    expect(reply.readUInt16BE(6)).toBe(0);
  });
  it.each([
    "127-0-0-1",
    "8-8-8-8",
    "fd12--1",
    "anything",
    "192-168-001-1",
    "evil.other",
  ])("rejects noncanonical or ineligible name %s", (label) => {
    const reply = answer(`${label}.${domain}`);
    expect(reply.readUInt16BE(2) & 15).toBe(3);
    expect(reply.readUInt16BE(8)).toBe(1);
  });
  it("serves simultaneous TXT and signals database failure instead of pretending that challenges are absent", () => {
    const values = ["a".repeat(43), "b".repeat(43)];
    const respond = responder(vi.fn(() => values));
    const request = query(`_acme-challenge.192-168-1-50.${domain}`, 16);
    const reply = respond(request);
    expect(reply?.readUInt16BE(6)).toBe(2);
    for (const value of values)
      expect(reply?.includes(Buffer.from(value))).toBe(true);
    const unavailable = responder(
      vi.fn(() => {
        throw new Error("unavailable");
      }),
    )(request);
    expect((unavailable?.readUInt16BE(2) ?? -1) & 15).toBe(2);
    expect(unavailable?.readUInt16BE(6)).toBe(0);
  });
  it("truncates at whole records for UDP and supplies the full bounded response on TCP", () => {
    const respond = responder(
      vi.fn(() =>
        Array.from({ length: 32 }, (_, i) => `${i}`.padStart(43, "a")),
      ),
    );
    const request = query(`_acme-challenge.192-168-1-50.${domain}`, 16);
    const udp = respond(request),
      tcp = respond(request, "tcp");
    expect(udp?.length).toBeLessThanOrEqual(512);
    expect((udp?.readUInt16BE(2) ?? -1) & 0x0200).toBe(0x0200);
    expect((tcp?.readUInt16BE(2) ?? -1) & 0x0200).toBe(0);
    expect(tcp?.readUInt16BE(6)).toBe(32);
  });
  it("bounds malformed packets and refuses ANY queries", () => {
    const respond = responder();
    expect(respond(Buffer.alloc(5))).toBeNull();
    expect(respond(Buffer.alloc(4097))).toBeNull();
    const packet = query(domain);
    packet[12] = 0xc0;
    expect((respond(packet)?.readUInt16BE(2) ?? -1) & 15).toBe(1);
    const highBit = query(domain);
    highBit[13] = 0xec;
    expect((respond(highBit)?.readUInt16BE(2) ?? -1) & 15).toBe(1);
    const multiple = query(domain);
    multiple.writeUInt16BE(2, 4);
    expect((respond(multiple)?.readUInt16BE(2) ?? -1) & 15).toBe(1);
    expect(answer(domain, 255).readUInt16BE(2) & 15).toBe(5);
  });
  it("answers a real unprivileged UDP socket and fragmented TCP frame on the same port", async () => {
    const server = await startLanHttpsDnsServer({
      host: "127.0.0.1",
      port: 0,
      respond: responder(),
    });
    const udp = createSocket("udp4"),
      tcp = connect({ host: "127.0.0.1", port: server.port });
    try {
      const packet = query(`192-168-1-50.${domain}`);
      const received = once(udp, "message");
      udp.send(packet, server.port, "127.0.0.1");
      const [datagram] = (await received) as [Buffer];
      expect(datagram.subarray(-4)).toEqual(Buffer.from([192, 168, 1, 50]));
      if (tcp.connecting) await once(tcp, "connect");
      const frame = Buffer.alloc(packet.length + 2);
      frame.writeUInt16BE(packet.length);
      packet.copy(frame, 2);
      const chunks: Buffer[] = [];
      const complete = new Promise<Buffer>((resolve, reject) => {
        tcp.on("error", reject);
        tcp.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          const all = Buffer.concat(chunks);
          if (all.length >= 2 && all.length === all.readUInt16BE(0) + 2)
            resolve(all.subarray(2));
        });
      });
      tcp.write(frame.subarray(0, 1));
      tcp.write(frame.subarray(1, 9));
      tcp.write(frame.subarray(9));
      expect((await complete).subarray(-4)).toEqual(
        Buffer.from([192, 168, 1, 50]),
      );
    } finally {
      udp.close();
      tcp.destroy();
      await server.close();
    }
  });
});
