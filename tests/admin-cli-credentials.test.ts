import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32")(
  "registers an Admin CLI credential before command parsing starts",
  () => {
    const configRoot = mkdtempSync(join(tmpdir(), "latex-render-admin-cli-"));
    const key = `lra_${"a".repeat(32)}_${"b".repeat(43)}`;
    try {
      chmodSync(configRoot, 0o700);
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "apps/admin-cli/src/index.ts",
          "auth",
          "login",
          "--api-key-stdin",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            XDG_CONFIG_HOME: configRoot,
            LATEX_RENDER_ADMIN_API_KEY: "",
          },
          input: `${key}\n`,
          encoding: "utf8",
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(key);
      const credential = join(configRoot, "latex-renderer", "admin-credential");
      expect(readFileSync(credential, "utf8")).toBe(key);
      expect(statSync(credential).mode & 0o077).toBe(0);
    } finally {
      rmSync(configRoot, { recursive: true, force: true });
    }
  },
);
