import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingressTlsFixture } from "./fixtures/server-ingress.js";
import { installLanHttpsOperatorCertificate } from "../deploy/lan-https/operator-certificate.mjs";
import { validateLanHttpsAuthorityConfiguration } from "../deploy/lan-https/configuration.mjs";
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lan-operator-cert-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const tls = ingressTlsFixture({ subjectAltName: "DNS:*.lan.example.test" });
  cleanups.push(tls.cleanup);
  chmodSync(tls.certificatePath, 0o644);
  chmodSync(tls.keyPath, 0o600);
  const output = join(root, "bundle.pem");
  const config = validateLanHttpsAuthorityConfiguration({
    format: 1,
    role: "authority",
    stateDirectory: root,
    policy: {
      format: 1,
      registration: "open",
      serverOrigin: "https://akebi.example.test",
      lanDomain: "lan.example.test",
    },
    http: { address: "127.0.0.1", port: 3181, trustLoopbackProxy: true },
    dns: {
      listeners: [{ address: "127.0.0.1", port: 53 }],
      nameserver: "ns1.example.test",
      caaIssuers: ["letsencrypt.org"],
    },
    issuers: [
      {
        id: "ca",
        directoryUrl: "https://ca.example.test/directory",
        newAccountUrl: "https://ca.example.test/newAccount",
      },
    ],
    keyless: { bundleFile: output },
  });
  const options = {
    config,
    certificateFile: tls.certificatePath,
    keyFile: tls.keyPath,
    trustedCertificates: [tls.certificate.toString()],
  };
  return { root, tls, output, options };
}
it("imports an ordinary-trust checked wildcard and reclaims an interrupted private replacement", async () => {
  const f = fixture();
  writeFileSync(join(f.root, ".operator-certificate.pending"), "incomplete", {
    mode: 0o600,
  });
  const result = await installLanHttpsOperatorCertificate(f.options);
  expect(result.fingerprint256).toMatch(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
  expect(readFileSync(f.output).toString()).toContain(
    f.tls.certificate.toString(),
  );
  expect(existsSync(join(f.root, ".operator-certificate.pending"))).toBe(false);
});
it("preserves the published bundle on ENOSPC and refuses an external pending symlink", async () => {
  const f = fixture();
  await installLanHttpsOperatorCertificate(f.options);
  const before = readFileSync(f.output);
  await expect(
    installLanHttpsOperatorCertificate({
      ...f.options,
      writeBytes: () => {
        throw Object.assign(new Error("fixture full"), { code: "ENOSPC" });
      },
    }),
  ).rejects.toThrow(/fixture full/);
  expect(readFileSync(f.output)).toEqual(before);
  const external = join(f.root, "untouched");
  writeFileSync(external, "retained");
  symlinkSync(external, join(f.root, ".operator-certificate.pending"));
  await expect(installLanHttpsOperatorCertificate(f.options)).rejects.toThrow(
    /Unsafe interrupted/,
  );
  expect(readFileSync(external, "utf8")).toBe("retained");
  expect(readFileSync(f.output)).toEqual(before);
});
