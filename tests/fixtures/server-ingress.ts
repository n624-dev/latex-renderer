import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

export function ingressTlsFixture(
  options: {
    ca?: boolean;
    subjectAltName?: string | null;
    extendedKeyUsage?: string;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "renderer-ingress-tls-"));
  try {
    const certificate = join(root, "cert.pem");
    const key = join(root, "key.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        `basicConstraints=critical,CA:${options.ca ? "TRUE" : "FALSE"}`,
        ...(options.subjectAltName === null
          ? []
          : [
              "-addext",
              `subjectAltName=${options.subjectAltName ?? "DNS:localhost,IP:127.0.0.1,IP:::1"}`,
            ]),
        "-addext",
        `extendedKeyUsage=${options.extendedKeyUsage ?? "serverAuth"}`,
        "-out",
        certificate,
        "-keyout",
        key,
      ],
      { stdio: "ignore", timeout: 10000 },
    );
    return {
      root,
      certificatePath: certificate,
      keyPath: key,
      certificate: readFileSync(certificate),
      key: readFileSync(key),
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
