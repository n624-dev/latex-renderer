import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { publishRelease } from "../deploy/scripts/release-publication.mjs";
import { waitForPublishedMcpbAssets } from "../deploy/scripts/verify-public-mcpb-assets.mjs";

it.skipIf(process.platform === "win32")(
  "verifies the immutable publication after the same source is rebuilt with another CMS key",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "reused-cms-"));
    const source = join(root, "source"),
      releasesRoot = join(root, "releases"),
      journalRoot = join(root, "journals");
    const version = "7.8.9",
      commit = "a".repeat(40),
      releaseId = `v${version}-${commit.slice(0, 12)}`;
    const archive = `latex-renderer-local-${version}.mcpb`;
    const driver = "deploy/scripts/deploy-production-release.sh";
    const hash = (bytes: Buffer) =>
      createHash("sha256").update(bytes).digest("hex");
    const run = (command: string, args: string[], cwd = root) =>
      execFileSync(command, args, {
        cwd,
        timeout: 20000,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
    const server = createServer((request, response) => {
      const name = new URL(
        request.url ?? "/",
        "http://localhost",
      ).pathname.slice(1);
      if (![archive, "mcpb.json"].includes(name)) {
        response.writeHead(404).end();
        return;
      }
      void readFile(join(releasesRoot, releaseId, "client-dist", name)).then(
        (bytes) => response.end(bytes),
        () => response.writeHead(500).end(),
      );
    });
    try {
      for (const path of [
        join(source, "deploy/scripts"),
        join(source, "client-dist"),
        releasesRoot,
      ])
        await mkdir(path, { recursive: true, mode: 0o755 });
      const driverBytes = await readFile(driver);
      await writeFile(join(source, driver), driverBytes);
      await writeFile(
        join(source, "package.json"),
        JSON.stringify({ version }),
      );
      const identity = { schemaVersion: 1, version, commit };
      await writeFile(
        join(source, ".latex-renderer-release.json"),
        JSON.stringify({ ...identity, repository: "n624-dev/latex-renderer" }),
      );
      await writeFile(
        join(source, ".latex-renderer-updater.json"),
        JSON.stringify({
          ...identity,
          files: {
            [driver]: { sha256: hash(driverBytes), bytes: driverBytes.length },
          },
        }),
      );
      await writeFile(join(root, "unsigned"), "same unsigned MCPB content");
      const signed = async (key: string) => {
        run("openssl", [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          `${key}.key`,
          "-out",
          `${key}.pem`,
          "-days",
          "1",
          "-subj",
          `/CN=${key}`,
        ]);
        run("openssl", [
          "cms",
          "-sign",
          "-binary",
          "-in",
          "unsigned",
          "-signer",
          `${key}.pem`,
          "-inkey",
          `${key}.key`,
          "-outform",
          "DER",
          "-out",
          `${key}.cms`,
        ]);
        const signature = await readFile(join(root, `${key}.cms`)),
          length = Buffer.alloc(4);
        length.writeUInt32LE(signature.length);
        const bytes = Buffer.concat([
          await readFile(join(root, "unsigned")),
          Buffer.from("MCPB_SIG_V1"),
          length,
          signature,
          Buffer.from("MCPB_SIG_END"),
        ]);
        const metadata = {
          version,
          archive,
          size: bytes.length,
          sha256: hash(bytes),
        };
        await writeFile(join(source, "client-dist", archive), bytes);
        await writeFile(
          join(source, "client-dist/mcpb.json"),
          JSON.stringify(metadata),
        );
        return metadata;
      };
      const options = {
        source,
        releasesRoot,
        journalRoot,
        releaseId,
        copy: async (s: string, d: string) =>
          cp(s, d, { recursive: true, verbatimSymlinks: true }),
      };
      const first = await signed("first");
      expect((await publishRelease(options)).reused).toBe(false);
      const second = await signed("second");
      expect(second.sha256).not.toBe(first.sha256);
      expect((await publishRelease(options)).reused).toBe(true);
      // Execute the deployment driver's branch, rather than reimplementing it.
      const script = driverBytes.toString();
      const selection = script.slice(
        script.indexOf(
          'if [ "$deployment_mode" = standalone ]; then',
          script.indexOf('client_base="$public_origin/downloads/client"'),
        ),
        script.indexOf('archive_path="$temporary_root/client-archive.zip"'),
      );
      const selected = execFileSync(
        "bash",
        ["-eu", "-c", `${selection}\nprintf '%s' "$local_mcpb_manifest_path"`],
        {
          env: {
            ...process.env,
            deployment_mode: "standalone",
            published_root: join(releasesRoot, releaseId),
            build_root: source,
          },
          encoding: "utf8",
        },
      );
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing listener");
      const downloaded = join(root, "downloaded.mcpb");
      const verify = {
        baseUrl: `http://127.0.0.1:${address.port}`,
        localMetadataPath: selected,
        archiveOutputPath: downloaded,
        releaseId,
        attempts: 1,
      };
      expect(await waitForPublishedMcpbAssets(verify)).toBe(first.sha256);
      await expect(
        waitForPublishedMcpbAssets({
          ...verify,
          localMetadataPath: join(source, "client-dist/mcpb.json"),
        }),
      ).rejects.toThrow("does not match");
      // Keep the real CMS verification. Only the external manifest CLI is isolated.
      const verifier = join(root, "client/verify-mcpb.mjs"),
        cli = join(root, "node_modules/@anthropic-ai/mcpb/dist/cli");
      await mkdir(join(root, "client"));
      await mkdir(cli, { recursive: true });
      await cp(resolve("client/verify-mcpb.mjs"), verifier);
      await writeFile(
        join(cli, "cli.js"),
        "if(process.argv[2]!=='validate') process.exit(42);\n",
      );
      expect(() =>
        run(process.execPath, [verifier, downloaded, selected]),
      ).not.toThrow();
      // Execute the driver's actual private handoff as an ordinary user. Only
      // ownership changes and runuser are substituted here. The disposable
      // update CI separately enforces the real cross-user EACCES boundary.
      const handoff = script
        .slice(
          script.indexOf("mcpb_verify_root=$(mktemp"),
          script.indexOf('cache_buster="release='),
        )
        .replaceAll("/usr/local/bin/node", '"$node_binary"');
      const temporary = join(root, "handoff");
      await mkdir(temporary);
      await cp(downloaded, join(temporary, "latex-renderer-local.mcpb"));
      const privateRoot = execFileSync(
        "bash",
        [
          "-eu",
          "-c",
          `
        mktemp() { command mktemp -d "$temporary_root/private.XXXXXX"; }
        chown() { return 0; }
        install() { shift 4; command install "$@"; }
        runuser() { shift 3; "$@"; }
        ${handoff}
        printf '\\n%s' "$mcpb_verify_root"
      `,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            source_root: root,
            temporary_root: temporary,
            local_mcpb_manifest_path: selected,
            sync_user: "fixture",
            sync_group: "fixture",
            node_binary: process.execPath,
          },
        },
      )
        .trim()
        .split("\n")
        .at(-1);
      if (!privateRoot)
        throw new Error("Missing private MCPB handoff directory");
      try {
        expect(await readFile(join(privateRoot, "mcpb.json"))).toEqual(
          await readFile(selected),
        );
        expect((await lstat(privateRoot)).mode & 0o777).toBe(0o700);
        expect((await lstat(join(privateRoot, "mcpb.json"))).mode & 0o777).toBe(
          0o600,
        );
      } finally {
        await rm(privateRoot, { recursive: true, force: true });
      }
      expect(() =>
        run(process.execPath, [
          verifier,
          downloaded,
          join(source, "client-dist/mcpb.json"),
        ]),
      ).toThrow();
      const tampered = await readFile(downloaded);
      tampered[0] = (tampered[0] ?? 0) ^ 1;
      await writeFile(downloaded, tampered);
      const tamperedMetadata = join(root, "tampered.json");
      await writeFile(
        tamperedMetadata,
        JSON.stringify({ ...first, sha256: hash(tampered) }),
      );
      expect(() =>
        run(process.execPath, [verifier, downloaded, tamperedMetadata]),
      ).toThrow();
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
