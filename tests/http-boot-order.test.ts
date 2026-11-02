import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "linux")(
  "verifies the real systemd boot graph with recovery before HTTP listeners",
  () => {
    const root = mkdtempSync(join(tmpdir(), "http-boot-order-"));
    try {
      const units = join(root, "etc/systemd/system");
      mkdirSync(join(units, "sockets.target.wants"), { recursive: true });
      mkdirSync(join(root, "usr/bin"), { recursive: true });
      writeFileSync(join(root, "usr/bin/true"), "fixture executable\n");
      chmodSync(join(root, "usr/bin/true"), 0o755);
      const socketDefinition = readFileSync(
        "deploy/systemd/latex-renderer-api.socket",
        "utf8",
      );
      const contents: Record<string, string> = {
        "multi-user.target":
          "[Unit]\nRequires=basic.target\nAfter=basic.target\n",
        "basic.target":
          "[Unit]\nDefaultDependencies=no\nRequires=sysinit.target sockets.target\nAfter=sysinit.target sockets.target\n",
        "sysinit.target": "[Unit]\nDefaultDependencies=no\n",
        "sockets.target": "[Unit]\nDefaultDependencies=no\n",
        "shutdown.target": "[Unit]\nDefaultDependencies=no\n",
        "local-fs.target":
          "[Unit]\nDefaultDependencies=no\nBefore=sysinit.target\n",
        "latex-renderer-authentication-recovery.service":
          "[Unit]\nAfter=local-fs.target\nBefore=latex-renderer-api.service\n[Service]\nType=oneshot\nExecStart=/usr/bin/true\n",
        "latex-renderer-api.service":
          "[Unit]\nRequires=latex-renderer-authentication-recovery.service\nAfter=latex-renderer-authentication-recovery.service\n[Service]\nExecStart=/usr/bin/true\n",
        "latex-renderer-api.socket": socketDefinition,
      };
      for (const [name, text] of Object.entries(contents))
        writeFileSync(join(units, name), text);
      symlinkSync(
        "../latex-renderer-api.socket",
        join(units, "sockets.target.wants/latex-renderer-api.socket"),
      );
      const verify = () =>
        spawnSync(
          "systemd-analyze",
          ["--root", root, "verify", "multi-user.target"],
          { encoding: "utf8", timeout: 10000 },
        );
      const valid = verify();
      expect(valid.status, valid.stderr).toBe(0);
      expect(valid.stderr).not.toMatch(/ordering cycle|deleted.*cycle/i);
      // Prove the fixture detects the actual regression: the socket's default
      // Before=sockets.target conflicts with recovery's After=basic.target.
      writeFileSync(
        join(units, "latex-renderer-api.socket"),
        socketDefinition.replace(
          "DefaultDependencies=no",
          "DefaultDependencies=yes",
        ),
      );
      expect(verify().stderr).toMatch(/ordering cycle|deleted.*cycle/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
