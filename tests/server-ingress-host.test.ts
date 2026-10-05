import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ingressTlsFixture } from "./fixtures/server-ingress.js";
import {
  validateServerIngressReview,
  SERVER_INGRESS_TLS_PATHS,
} from "../packages/server-setup-core/src/index.mjs";

const synthetic = vi.hoisted(() => ({
  files: new Map<string, string>(),
  descriptors: new Set<number>(),
  uid: 0,
  gid: 45678,
  mode: 0o440,
  directoryUid: 0,
  directoryMode: 0o755,
  directorySymlink: false,
}));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    openSync: vi.fn(
      (
        path: Parameters<typeof fs.openSync>[0],
        flags: Parameters<typeof fs.openSync>[1],
      ) => {
        const mapped =
          typeof path === "string" ? synthetic.files.get(path) : undefined;
        const fd = fs.openSync(mapped ?? path, flags);
        if (mapped) synthetic.descriptors.add(fd);
        return fd;
      },
    ),
    closeSync: (fd: number) => {
      synthetic.descriptors.delete(fd);
      fs.closeSync(fd);
    },
    fstatSync: (fd: number) => {
      const stat = fs.fstatSync(fd);
      if (synthetic.descriptors.has(fd))
        return Object.assign(stat, {
          uid: synthetic.uid,
          gid: synthetic.gid,
          mode: 0o100000 | synthetic.mode,
        });
      return stat;
    },
    lstatSync: (path: Parameters<typeof fs.lstatSync>[0]) => {
      if (
        ["/etc", "/etc/latex-renderer", "/etc/latex-renderer/secrets"].includes(
          String(path),
        )
      )
        return {
          uid: synthetic.directoryUid,
          mode: synthetic.directoryMode,
          isDirectory: () => true,
          isSymbolicLink: () => synthetic.directorySymlink,
        };
      return fs.lstatSync(path);
    },
  };
});
import { verifyProductionIngressTls } from "../deploy/scripts/server-ingress.mjs";

const review = validateServerIngressReview({
  format: 1,
  mode: "standalone",
  publicOrigin: "https://localhost",
  accessScope: "local",
  tlsProvider: "custom",
  listenAddress: "127.0.0.1",
});
let fixture: ReturnType<typeof ingressTlsFixture>;
const created: ReturnType<typeof ingressTlsFixture>[] = [];
beforeAll(() => {
  fixture = ingressTlsFixture();
  created.push(fixture);
  synthetic.files.set(
    SERVER_INGRESS_TLS_PATHS.certificate,
    fixture.certificatePath,
  );
  synthetic.files.set(SERVER_INGRESS_TLS_PATHS.privateKey, fixture.keyPath);
});
afterEach(() => {
  Object.assign(synthetic, {
    uid: 0,
    gid: 45678,
    mode: 0o440,
    directoryUid: 0,
    directoryMode: 0o755,
    directorySymlink: false,
  });
  expect(synthetic.descriptors.size).toBe(0);
});
afterAll(() => {
  for (const value of created) value.cleanup();
});

describe("privileged ingress TLS adapter with synthetic root metadata and real temporary TLS bytes", () => {
  it("verifies the fixed custom slots without mutating files and returns no key material", () => {
    expect(verifyProductionIngressTls(review, 45678)?.publicOrigin).toBe(
      "https://localhost",
    );
  });
  it.each([
    { uid: 1 },
    { gid: 1 },
    { mode: 0o444 },
    { mode: 0o640 },
    { mode: 0o2440 },
    { directoryUid: 1 },
    { directoryMode: 0o775 },
    { directorySymlink: true },
  ])(
    "rejects insecure custom TLS ownership/permissions/parents %j",
    (change) => {
      Object.assign(synthetic, change);
      expect(() => verifyProductionIngressTls(review, 45678)).toThrow(
        /unsafe|root-controlled/,
      );
    },
  );
  it("does not touch standalone secrets for legacy or existing Cloudflare installations", () => {
    synthetic.directorySymlink = true;
    expect(verifyProductionIngressTls(null, 45678)).toBeNull();
    expect(
      verifyProductionIngressTls(
        validateServerIngressReview({
          format: 1,
          mode: "cloudflare",
          publicOrigin: "https://renderer.example.test",
          accessScope: "internet",
          tlsProvider: "cloudflare",
        }),
        45678,
      ),
    ).toBeNull();
  });
});
