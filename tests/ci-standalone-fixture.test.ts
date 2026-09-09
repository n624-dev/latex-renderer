import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  ciHostname,
  ciCertificate,
  ciPrivateKey,
  standaloneEnvironment,
  standaloneProxy,
} from "../deploy/ci/standalone-fixture.mjs";
import {
  parseEnvironmentFile,
  validateProfileValues,
} from "../deploy/scripts/validate-production-profile.mjs";

const template = readFileSync(".env.example", "utf8");
it("rejects the original example but accepts the actual generated CI profile", () => {
  expect(() => validateProfileValues(parseEnvironmentFile(template))).toThrow(
    "example placeholder",
  );
  const generated = standaloneEnvironment(template);
  expect(() =>
    validateProfileValues(parseEnvironmentFile(generated)),
  ).not.toThrow();
  const values = parseEnvironmentFile(generated);
  for (const key of ["PUBLIC_ORIGIN", "RENDERER_PUBLIC_URL", "ADMIN_API_URL"])
    expect(values.get(key)).toBe(`https://${ciHostname}`);
  expect(values.get("DEPLOYMENT_MODE")).toBe("standalone");
  expect(values.get("AUTH_MODE")).toBe("password");
  expect(generated).toContain(`NODE_EXTRA_CA_CERTS=${ciCertificate}`);
});
it("uses the same host and certificate paths throughout the actual proxy template", () => {
  const proxy = standaloneProxy(
    readFileSync("deploy/reverse-proxy/nginx.conf.example", "utf8"),
  );
  expect(proxy).not.toContain("latex.example.com");
  expect(proxy).not.toContain("/etc/letsencrypt/");
  expect(proxy).toContain(`server_name ${ciHostname};`);
  expect(proxy).toContain(`proxy_set_header Host ${ciHostname};`);
  expect(proxy).toContain(`proxy_set_header X-Forwarded-Host ${ciHostname};`);
  expect(proxy).toContain(`ssl_certificate ${ciCertificate};`);
  expect(proxy).toContain(`ssl_certificate_key ${ciPrivateKey};`);
});
it("does not suppress unrelated production-profile errors", () => {
  expect(() =>
    standaloneEnvironment(
      template.replace("AUTH_MODE=password", "AUTH_MODE=invalid"),
    ),
  ).toThrow("AUTH_MODE");
  expect(() =>
    standaloneEnvironment(template + "\nPUBLIC_ORIGIN=https://other.test\n"),
  ).toThrow("duplicate");
});
it("derives certificate identity and hosts entry from the shared fixture hostname", () => {
  const script = readFileSync("deploy/ci/provision-update-host.mjs", "utf8");
  expect(script).toContain("`/CN=${ciHostname}`");
  expect(script).toContain("`subjectAltName=DNS:${ciHostname}`");
  expect(script).toContain("`\\n127.0.0.1 ${ciHostname}\\n`");
  expect(
    script.indexOf("const environment = standaloneEnvironment"),
  ).toBeLessThan(script.indexOf('run("/bin/sh"'));
});
