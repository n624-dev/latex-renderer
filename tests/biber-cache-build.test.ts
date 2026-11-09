import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe.skipIf(process.platform === "win32")("immutable Biber cache", () => {
  it.each(["ready", "silent", "incomplete", "failed"])(
    "publishes permissions only after complete extraction (%s)",
    (mode) => {
      const root = mkdtempSync(join(tmpdir(), "biber-cache-"));
      const cache = join(root, "cache"),
        bin = join(root, "bin");
      mkdirSync(bin);
      const helper = join(root, "install.sh");
      writeFileSync(
        helper,
        readFileSync(
          "renderer/install-language-packages.sh",
          "utf8",
        ).replaceAll("/opt/renderer/biber-cache", cache),
      );
      writeFileSync(
        join(bin, "biber"),
        `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
if(process.argv.slice(2).join(' ')!=='--version')process.exit(90);
if(['PAR_TEMP','PAR_CLEAN','PAR_GLOBAL_CLEAN','PAR_GLOBAL_TMPDIR'].some(k=>process.env[k]!==undefined))process.exit(91);
if(process.env.TEST_MODE==='failed')process.exit(42);
if(process.env.TEST_MODE==='silent')process.exit(0);
console.log('biber version: 2.22');
if(process.env.TEST_MODE==='incomplete')process.exit(0);
const cache=process.env.PAR_GLOBAL_TEMP;
fs.mkdirSync(path.join(cache,'inc'));
fs.writeFileSync(path.join(cache,'inc','fixture.so'),'native module');
fs.writeFileSync(path.join(cache,'_CANARY_.txt'),'complete');
fs.writeFileSync(path.join(cache,'biber'),'executable',{mode:0o750});
`,
        { mode: 0o700 },
      );
      try {
        const result = spawnSync("sh", [helper, "--prepare-biber-cache"], {
          encoding: "utf8",
          timeout: 10000,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? ""}`,
            TEST_MODE: mode,
            PAR_TEMP: "/untrusted",
            PAR_GLOBAL_TMPDIR: "/untrusted",
            PAR_CLEAN: "1",
            PAR_GLOBAL_CLEAN: "1",
          },
        });
        expect(result.status === 0, result.stderr).toBe(mode === "ready");
        if (mode === "ready") {
          expect(statSync(cache).mode & 0o777).toBe(0o555);
          expect(statSync(join(cache, "inc")).mode & 0o777).toBe(0o555);
          expect(statSync(join(cache, "biber")).mode & 0o777).toBe(0o555);
          expect(statSync(join(cache, "_CANARY_.txt")).mode & 0o777).toBe(
            0o444,
          );
          expect(readlinkSync(join(cache, "inc.lock"))).toBe(
            "/tmp/renderer-biber-inc.lock",
          );
          expect(statSync(join(cache, "inc/fixture.so")).nlink).toBe(2);
        }
      } finally {
        chmodSync(cache, 0o700);
        if (existsSync(join(cache, "inc")))
          chmodSync(join(cache, "inc"), 0o700);
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
