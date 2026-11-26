import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachmentOrigins,
  downloadAttachment,
} from "../packages/remote-mcp-core/src/attachment-download.js";

const destination = "unused";
const lookup = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));
vi.mock("node:https", () => ({ get }));

afterEach(() => {
  lookup.mockReset();
  get.mockReset();
});

describe("host-provided source attachments", () => {
  const origin = "https://attachments.example.test";
  const origins = attachmentOrigins(origin);

  it("accepts exact HTTPS DNS origins and rejects URL configuration with a path", () => {
    expect(attachmentOrigins(` ${origin}/ , ${origin}`)).toEqual(origins);
    expect(() => attachmentOrigins(`${origin}/download`)).toThrow();
    expect(() => attachmentOrigins("https://127.0.0.1")).toThrow();
  });

  it.each([
    "http://attachments.example.test/document.zip",
    "https://attachments.example.test.invalid/document.zip",
    "https://unrelated.example.test/document.zip",
    "https://user@attachments.example.test/document.zip",
    "https://attachments.example.test/document.zip#fragment",
  ])(
    "rejects a URL outside the authorized origin before resolving it",
    async (url) => {
      await expect(
        downloadAttachment(url, origins, destination, 128),
      ).rejects.toMatchObject({
        code: "ATTACHMENT_ORIGIN_INVALID",
      });
      expect(lookup).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("rejects non-public resolved destinations without opening a connection", async () => {
    lookup.mockResolvedValue([
      { address: "127.0.0.1", family: 4 },
      { address: "192.168.20.10", family: 4 },
      { address: "::ffff:169.254.10.12", family: 6 },
      { address: "fc01::1", family: 6 },
      { address: "2001:0:1234::1", family: 6 },
      { address: "3fff::1", family: 6 },
    ]);
    await expect(
      downloadAttachment(`${origin}/document.zip`, origins, destination, 128),
    ).rejects.toMatchObject({ code: "ATTACHMENT_ORIGIN_INVALID" });
    expect(get).not.toHaveBeenCalled();
  });

  it("connects to the checked address and retains the trusted hostname for TLS", async () => {
    lookup.mockResolvedValue([
      { address: "192.168.20.10", family: 4 },
      { address: "93.184.216.34", family: 4 },
    ]);
    const stopped = new Error("fixture: no network request");
    get.mockImplementation(() => {
      throw stopped;
    });

    await expect(
      downloadAttachment(`${origin}/document.zip`, origins, destination, 128),
    ).rejects.toBe(stopped);
    expect(lookup).toHaveBeenCalledExactlyOnceWith("attachments.example.test", {
      all: true,
    });
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "93.184.216.34",
        servername: "attachments.example.test",
        rejectUnauthorized: true,
        agent: false,
        path: "/document.zip",
      }),
      expect.any(Function),
    );
  });
});
