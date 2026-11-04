import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  lstatSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { storeLanHttpsEabCredentials } from "../deploy/lan-https/prepare-eab.mjs";
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lan-eab-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    path: join(root, "eab.json"),
    credentials: {
      kid: "fixture",
      hmacKey: randomBytes(32).toString("base64url"),
    },
  };
}
it("saves validated credentials privately and returns only nonsecret confirmation", () => {
  const f = fixture();
  const result = storeLanHttpsEabCredentials(f.path, {
    kid: ` ${f.credentials.kid}\n`,
    hmacKey: f.credentials.hmacKey + "=",
  });
  expect(result.kidCharacters).toBe(f.credentials.kid.length);
  expect(result.hmacCharacters).toBe(43);
  expect(JSON.stringify(result)).not.toContain(f.credentials.hmacKey);
  expect(JSON.parse(readFileSync(f.path, "utf8"))).toEqual(f.credentials);
  expect(lstatSync(f.path).mode & 0o777).toBe(0o600);
  expect(() => storeLanHttpsEabCredentials(f.path, f.credentials)).toThrow();
  expect(JSON.parse(readFileSync(f.path, "utf8"))).toEqual(f.credentials);
});
it("refuses invalid values, repository destinations and symlinks without changing the target", () => {
  const f = fixture();
  expect(() =>
    storeLanHttpsEabCredentials(f.path, { kid: "fixture", hmacKey: "short" }),
  ).toThrow();
  expect(() =>
    storeLanHttpsEabCredentials(
      fileURLToPath(new URL("../eab-secret.json", import.meta.url)),
      f.credentials,
    ),
  ).toThrow(/outside the repository/);
  storeLanHttpsEabCredentials(f.path, f.credentials);
  const link = join(f.root, "link.json");
  symlinkSync(f.path, link);
  expect(() => storeLanHttpsEabCredentials(link, f.credentials)).toThrow();
  expect(JSON.parse(readFileSync(f.path, "utf8"))).toEqual(f.credentials);
});
it("refuses noninteractive secret input and never echoes a supplied value", () => {
  const f = fixture();
  const output = spawnSync(
    process.execPath,
    ["deploy/lan-https/prepare-eab.mjs", "--output", f.path],
    { input: JSON.stringify(f.credentials), encoding: "utf8", timeout: 5000 },
  );
  expect(output.status).not.toBe(0);
  expect(output.stdout + output.stderr).not.toContain(f.credentials.hmacKey);
});
