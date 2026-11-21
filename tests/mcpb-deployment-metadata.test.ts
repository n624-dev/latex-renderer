import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writeMcpbZipFixture } from "./fixtures/mcpb-bundle.js";

describe("MCPB deployment metadata", () => {
  it("passes the exact published metadata to the unprivileged verifier", () => {
    const deploy = readFileSync(
      "deploy/scripts/deploy-production-release.sh",
      "utf8",
    );
    expect(deploy).toContain(
      [
        '"$mcpb_verify_root/latex-renderer-local.mcpb" \\',
        '  "$mcpb_verify_root/mcpb.json"',
      ].join("\n"),
    );
    expect(deploy).toContain('"$mcpb_base" "$local_mcpb_manifest_path"');
    expect(deploy).toContain(
      'install -o "$sync_user" -g "$sync_group" -m 0600 \\\n  "$local_mcpb_manifest_path" "$mcpb_verify_root/mcpb.json"',
    );
    // Both modes must use the same selected metadata for the downloaded bytes
    // and the unprivileged signature verifier; branch selection is exercised
    // by bootstrap-distribution.test.ts.
    expect(deploy).toContain(
      'local_mcpb_manifest_path="$published_root/client-dist/mcpb.json"',
    );
    expect(deploy).toContain(
      'local_mcpb_manifest_path="$build_root/apps/public-web/dist/downloads/mcpb/mcpb.json"',
    );
  });

  it.skipIf(process.platform === "win32")(
    "accepts a newly signed bundle only with matching metadata and retains signature checks",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "renderer-mcpb-metadata-"));
      const run = (command: string, args: string[]) =>
        spawnSync(command, args, {
          cwd: root,
          encoding: "utf8",
          timeout: 20_000,
        });
      const hash = (bytes: Buffer) =>
        createHash("sha256").update(bytes).digest("hex");
      try {
        mkdirSync(join(root, "client/mcpb"), { recursive: true });
        mkdirSync(join(root, "client-dist"));
        symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
        for (const file of [
          "client/verify-mcpb.mjs",
          "client/mcpb-format.mjs",
          "client/mcpb/manifest.json",
          "client/mcpb/mcpb-manifest-v0.4.schema.json",
        ])
          copyFileSync(file, join(root, file));
        const manifest = readFileSync("client/mcpb/manifest.json");
        const { version } = JSON.parse(manifest.toString()) as {
          version: string;
        };
        await writeMcpbZipFixture(join(root, "content"), manifest);
        const cert = run("openssl", [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          "key.pem",
          "-out",
          "cert.pem",
          "-days",
          "1",
          "-subj",
          "/CN=test-only",
        ]);
        expect(cert.status, cert.stderr).toBe(0);
        const sign = () => {
          const result = run("openssl", [
            "cms",
            "-sign",
            "-binary",
            "-in",
            "content",
            "-signer",
            "cert.pem",
            "-inkey",
            "key.pem",
            "-outform",
            "DER",
            "-out",
            "signature",
          ]);
          expect(result.status, result.stderr).toBe(0);
          const signature = readFileSync(join(root, "signature"));
          const length = Buffer.alloc(4);
          length.writeUInt32LE(signature.length);
          return Buffer.concat([
            readFileSync(join(root, "content")),
            Buffer.from("MCPB_SIG_V1"),
            length,
            signature,
            Buffer.from("MCPB_SIG_END"),
          ]);
        };
        const bytes = sign();
        const signature = readFileSync(join(root, "signature"));
        const archive = join(root, "published.mcpb");
        const published = join(root, "published.json");
        const stale = join(root, "client-dist/mcpb.json");
        const metadata = {
          archive: "published.mcpb",
          version,
          signature: "pkcs7",
          size: bytes.length,
          sha256: hash(bytes),
        };
        writeFileSync(archive, bytes);
        writeFileSync(published, JSON.stringify(metadata));
        writeFileSync(
          stale,
          JSON.stringify({ ...metadata, sha256: "0".repeat(64) }),
        );
        const verify = (...args: string[]) =>
          run(process.execPath, ["client/verify-mcpb.mjs", archive, ...args]);
        expect(verify().stderr).toContain("MCPB SHA-256 does not match");
        expect(verify(published).status).toBe(0);
        const tampered = Buffer.from(bytes);
        tampered[0] = (tampered[0] ?? 0) ^ 1;
        writeFileSync(archive, tampered);
        expect(verify(published).stderr).toContain(
          "MCPB SHA-256 does not match",
        );
        writeFileSync(
          published,
          JSON.stringify({ ...metadata, sha256: hash(tampered) }),
        );
        expect(verify(published).status).not.toBe(0);
        const alteredSignature = Buffer.from(bytes);
        const signatureStart =
          readFileSync(join(root, "content")).length +
          Buffer.byteLength("MCPB_SIG_V1") +
          4;
        alteredSignature[signatureStart + signature.length - 1] =
          (alteredSignature[signatureStart + signature.length - 1] ?? 0) ^ 1;
        const invalidLength = Buffer.from(bytes);
        invalidLength.writeUInt32LE(signature.length + 1, signatureStart - 4);
        // Matching metadata is not a substitute for independent CMS verification.
        for (const invalid of [
          alteredSignature,
          invalidLength,
          readFileSync(join(root, "content")),
          bytes.subarray(0, bytes.length - 1),
        ]) {
          writeFileSync(archive, invalid);
          writeFileSync(
            published,
            JSON.stringify({
              ...metadata,
              size: invalid.length,
              sha256: hash(invalid),
            }),
          );
          expect(verify(published).status).not.toBe(0);
        }
        for (const [fixture, expected] of [
          [{ serverMode: 0o120777 }, "Unexpected MCPB ZIP entry"],
          [{ serverPath: "server/other.cjs" }, "Unexpected MCPB ZIP entry"],
          [{ manifest: Buffer.from("{}") }, "Invalid MCPB manifest"],
          [
            {
              manifest: Buffer.from(
                manifest
                  .toString()
                  .replace("LaTeX Renderer Local", "Other name"),
              ),
            },
            "does not match the source manifest",
          ],
        ] as const) {
          await writeMcpbZipFixture(
            join(root, "content"),
            "manifest" in fixture ? fixture.manifest : manifest,
            "manifest" in fixture ? {} : fixture,
          );
          const invalid = sign();
          writeFileSync(archive, invalid);
          writeFileSync(
            published,
            JSON.stringify({
              ...metadata,
              size: invalid.length,
              sha256: hash(invalid),
            }),
          );
          expect(verify(published).stderr).toContain(expected);
        }
        writeFileSync(archive, bytes);
        writeFileSync(stale, JSON.stringify(metadata));
        expect(verify().status).toBe(0);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
