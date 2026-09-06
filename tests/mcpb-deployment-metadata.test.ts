import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("MCPB deployment metadata", () => {
  it("passes the exact published metadata to the unprivileged verifier", () => {
    const deploy = readFileSync(
      "deploy/scripts/deploy-production-release.sh",
      "utf8",
    );
    expect(deploy).toContain(
      [
        '"$mcpb_verify_root/latex-renderer-local.mcpb" \\',
        '  "$build_root/apps/public-web/dist/downloads/mcpb/mcpb.json"',
      ].join("\n"),
    );
  });

  it.skipIf(process.platform === "win32")(
    "accepts a newly signed bundle only with matching metadata and retains signature checks",
    () => {
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
        mkdirSync(join(root, "client"));
        mkdirSync(join(root, "client-dist"));
        const cli = join(root, "node_modules/@anthropic-ai/mcpb/dist/cli");
        mkdirSync(cli, { recursive: true });
        // Isolate the metadata/signature subprocess from the external manifest CLI.
        writeFileSync(
          join(cli, "cli.js"),
          "if (process.argv[2] !== 'validate') process.exit(42);\n",
        );
        copyFileSync(
          "client/verify-mcpb.mjs",
          join(root, "client/verify-mcpb.mjs"),
        );
        writeFileSync(join(root, "content"), "fixture bundle content");
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
        const sign = run("openssl", [
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
        expect(sign.status, sign.stderr).toBe(0);
        const signature = readFileSync(join(root, "signature"));
        const length = Buffer.alloc(4);
        length.writeUInt32LE(signature.length);
        const bytes = Buffer.concat([
          readFileSync(join(root, "content")),
          Buffer.from("MCPB_SIG_V1"),
          length,
          signature,
          Buffer.from("MCPB_SIG_END"),
        ]);
        const archive = join(root, "published.mcpb");
        const published = join(root, "published.json");
        const stale = join(root, "client-dist/mcpb.json");
        const metadata = {
          archive: "published.mcpb",
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
        writeFileSync(archive, bytes);
        writeFileSync(stale, JSON.stringify(metadata));
        expect(verify().status).toBe(0);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
