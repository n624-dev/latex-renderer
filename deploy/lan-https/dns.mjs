import { Buffer } from "node:buffer";
import { createSocket } from "node:dgram";
import { createServer, isIP } from "node:net";
import { URL } from "node:url";
import {
  lanHttpsAddress,
  normalizeLanHttpsDomain,
} from "../../packages/server-setup-core/src/lan-https.mjs";
import { createLanHttpsRateLimit } from "./rate-limit.mjs";

const TYPES = { A: 1, NS: 2, SOA: 6, TXT: 16, AAAA: 28, CAA: 257 };
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const dnsName = (name) =>
  Buffer.concat([
    ...name
      .split(".")
      .map((label) =>
        Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]),
      ),
    Buffer.from([0]),
  ]);
const rr = (name, type, ttl, data) =>
  Buffer.concat([
    dnsName(name),
    u16(type),
    u16(1),
    u32(ttl),
    u16(data.length),
    data,
  ]);

function question(packet) {
  let offset = 12,
    bytes = 0;
  const labels = [];
  while (true) {
    if (offset >= packet.length) throw new Error("DNS name missing terminator");
    const length = packet[offset++];
    if (length === 0) break;
    // Questions with compression/extended labels are rejected, never followed
    // into another message section or allowed to loop.
    if (length > 63 || offset + length > packet.length)
      throw new Error("Invalid DNS label");
    const label = packet
      .subarray(offset, offset + length)
      .toString("latin1")
      .toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(label))
      throw new Error("Invalid DNS label bytes");
    labels.push(label);
    offset += length;
    bytes += length + 1;
    if (bytes > 254) throw new Error("DNS name too long");
  }
  if (!labels.length || offset + 4 > packet.length)
    throw new Error("Invalid DNS question");
  return {
    name: labels.join("."),
    type: packet.readUInt16BE(offset),
    class: packet.readUInt16BE(offset + 2),
  };
}

function ipv6Bytes(address) {
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [head, tail] = canonical.split("::");
  const left = head ? head.split(":") : [],
    right = tail ? tail.split(":") : [];
  const words = canonical.includes("::")
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  const bytes = Buffer.alloc(16);
  words.forEach((word, i) => bytes.writeUInt16BE(parseInt(word, 16), i * 2));
  return bytes;
}

export function createLanHttpsDnsResponder(input) {
  const domain = normalizeLanHttpsDomain(input.domain);
  const nameserver = normalizeLanHttpsDomain(input.nameserver);
  const caaIssuers = input.caaIssuers ?? ["letsencrypt.org", "sectigo.com"];
  if (
    !Array.isArray(caaIssuers) ||
    caaIssuers.length < 1 ||
    caaIssuers.length > 8 ||
    caaIssuers.some((issuer) => normalizeLanHttpsDomain(issuer) !== issuer)
  )
    throw new Error("Invalid DNS CAA issuer policy");
  const soa = rr(
    domain,
    TYPES.SOA,
    30,
    Buffer.concat([
      dnsName(nameserver),
      dnsName(`hostmaster.${domain}`),
      ...[1, 3600, 600, 86400, 30].map(u32),
    ]),
  );
  const managed = new RegExp(
    `^i-[a-z0-9]{1,50}\\.instances\\.${domain.replaceAll(".", "\\.")}$`,
  );
  const eligibleName = (name) => {
    try {
      lanHttpsAddress(name, domain);
      return true;
    } catch {
      return managed.test(name);
    }
  };
  return (packet, transport = "udp") => {
    if (
      !Buffer.isBuffer(packet) ||
      packet.length < 12 ||
      packet.length > 4096 ||
      packet.readUInt16BE(2) & 0x8000
    )
      return null;
    const header = Buffer.alloc(12);
    header.writeUInt16BE(packet.readUInt16BE(0));
    let flags = 0x8000 | (packet.readUInt16BE(2) & 0x0100);
    let q = Buffer.alloc(0),
      answers = [],
      authorities = [];
    const reply = (rcode = 0) => {
      const limit = transport === "tcp" ? 16384 : 512;
      const accepted = [];
      let length = 12 + q.length;
      for (const record of [...answers, ...authorities]) {
        if (length + record.length > limit) {
          flags |= 0x0200;
          break;
        }
        accepted.push(record);
        length += record.length;
      }
      const answerCount = Math.min(accepted.length, answers.length);
      header.writeUInt16BE(flags | rcode, 2);
      header.writeUInt16BE(q.length ? 1 : 0, 4);
      header.writeUInt16BE(answerCount, 6);
      header.writeUInt16BE(accepted.length - answerCount, 8);
      return Buffer.concat([header, q, ...accepted]);
    };
    if (packet.readUInt16BE(2) & 0x7800) return reply(4);
    if (packet.readUInt16BE(4) !== 1) return reply(1);
    let query;
    try {
      query = question(packet);
    } catch {
      return reply(1);
    }
    q = Buffer.concat([dnsName(query.name), u16(query.type), u16(query.class)]);
    const { name, type } = query;
    if (query.class !== 1 || (name !== domain && !name.endsWith(`.${domain}`)))
      return reply(5);
    flags |= 0x0400;
    if (type === 255) return reply(5); // No ANY amplification or recursion.
    if (name === domain) {
      if (type === TYPES.NS)
        answers = [rr(domain, TYPES.NS, 3600, dnsName(nameserver))];
      else if (type === TYPES.SOA) answers = [soa];
      else if (type === TYPES.CAA)
        answers = caaIssuers.flatMap((issuer) =>
          ["issue", "issuewild"].map((tag) =>
            rr(
              domain,
              TYPES.CAA,
              3600,
              Buffer.concat([
                Buffer.from([0, tag.length]),
                Buffer.from(tag),
                Buffer.from(issuer),
              ]),
            ),
          ),
        );
    } else if (name.startsWith("_acme-challenge.")) {
      if (
        !eligibleName(name.slice(16)) &&
        ![domain, "authority-control." + domain].includes(name.slice(16))
      ) {
        authorities = [soa];
        return reply(3);
      }
      if (type === TYPES.TXT) {
        try {
          const values = input.challengeValues(name);
          if (
            !Array.isArray(values) ||
            values.length > 128 ||
            values.some(
              (value) =>
                typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value),
            )
          )
            throw new Error("Invalid DNS challenge state");
          answers = [...new Set(values)].map((value) =>
            rr(
              name,
              TYPES.TXT,
              10,
              Buffer.concat([Buffer.from([value.length]), Buffer.from(value)]),
            ),
          );
        } catch {
          return reply(2);
        }
      }
    } else {
      let address;
      try {
        address = lanHttpsAddress(name, domain);
      } catch {
        if (!managed.test(name)) {
          authorities = [soa];
          return reply(3);
        }
      }
      // Ordinary A/AAAA answers deliberately never touch registration/challenge
      // state. A database outage cannot prevent these stateless DNS answers.
      if (address && type === TYPES.A && isIP(address) === 4)
        answers = [
          rr(name, type, 3600, Buffer.from(address.split(".").map(Number))),
        ];
      if (address && type === TYPES.AAAA && isIP(address) === 6)
        answers = [rr(name, type, 3600, ipv6Bytes(address))];
    }
    if (!answers.length) authorities = [soa];
    return reply();
  };
}

// Explicit start/stop API. Port 0 is useful for unprivileged integration tests;
// production service configuration must explicitly select a public DNS listener.
export async function startLanHttpsDnsServer({
  host,
  port,
  respond,
  maxTcpConnections = 16,
  rateLimit = createLanHttpsRateLimit(),
}) {
  if (
    !isIP(host) ||
    !Number.isSafeInteger(port) ||
    port < 0 ||
    port > 65535 ||
    !Number.isSafeInteger(maxTcpConnections) ||
    maxTcpConnections < 1 ||
    maxTcpConnections > 128
  )
    throw new Error("Invalid bounded DNS listener configuration");
  const udp = createSocket(isIP(host) === 6 ? "udp6" : "udp4");
  const clients = new Set();
  const tcp = createServer((socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(2000, () => socket.destroy());
    let buffer = Buffer.alloc(0),
      requests = 0;
    socket.on("data", (chunk) => {
      if (buffer.length + chunk.length > 8196) return socket.destroy();
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const size = buffer.readUInt16BE(0);
        if (size < 12 || size > 4096 || requests >= 8) return socket.destroy();
        if (buffer.length < size + 2) break;
        const packet = buffer.subarray(2, size + 2);
        buffer = buffer.subarray(size + 2);
        requests++;
        if (!rateLimit.allow(socket.remoteAddress)) return socket.destroy();
        const answer = respond(packet, "tcp");
        if (!answer) return socket.destroy();
        // Bound slow-reader output to eight individually bounded DNS replies.
        socket.write(Buffer.concat([u16(answer.length), answer]));
      }
    });
  });
  tcp.maxConnections = maxTcpConnections;
  udp.on("message", (packet, peer) => {
    if (!rateLimit.allow(peer.address)) return;
    const answer = respond(packet, "udp");
    if (answer) udp.send(answer, peer.port, peer.address, () => {});
  });
  try {
    await new Promise((resolve, reject) => {
      tcp.once("error", reject);
      tcp.listen(port, host, () => {
        tcp.off("error", reject);
        resolve();
      });
    });
    const address = tcp.address();
    await new Promise((resolve, reject) => {
      udp.once("error", reject);
      udp.bind(address.port, host, () => {
        udp.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    for (const client of clients) client.destroy();
    if (tcp.listening) tcp.close();
    try {
      udp.close();
    } catch {
      /* UDP may not yet be bound. */
    }
    throw error;
  }
  return Object.freeze({
    port: tcp.address().port,
    close: async () => {
      for (const client of clients) client.destroy();
      await Promise.all([
        new Promise((resolve) => udp.close(resolve)),
        new Promise((resolve) => tcp.close(resolve)),
      ]);
    },
  });
}
