import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

// Published immutable RC1 cd3078e3432fa5a1b77e79ed2c90487e22005a07.
// Updating this contract requires an explicit bootstrap migration, not a hash bump.
const frozen = {
  "updater-bootstrap.mjs":
    "ec59e9d2ead82c24b2ee1cbad27eb205c1824f87c5689764c19ae51f3d43b561",
  "updater-entry.mjs":
    "330b972ad055a815f0c7c2972f09aa853e604dafe176dbcdf35943eead841ac0",
  "updater-slots.mjs":
    "402ebdba9d848bf80ef461ef4c1a8fd8a055cb2248a54ac19c28ded4ca81fd8e",
  "published-release.mjs":
    "8c9d729f8ebc09cc520fa856a5185594bfbc717966cdc1fa7af39643dda771c8",
  "release-attestation.mjs":
    "b7acdd46acb37e89147776000801ea709410585e37d0e733b8c3c40f05a85131",
  "release-version.mjs":
    "d7a4ef1be08e3b6eadaabd007731b7d560f9bc6e110e82151542a6591f512eb6",
  "release-archive.mjs":
    "3a764abbbea928ed7a598154602d06dc2cc5797dacfc6d2c07bb3018d58bd298",
  "mutation-lock.mjs":
    "5510f7ddbab0eb865dbe329ccd494b1b2d85f73440dad6676e894325bdfde791",
};

it.each(Object.entries(frozen))(
  "preserves installed bootstrap-v1 bytes: %s",
  (name, hash) => {
    expect(
      createHash("sha256")
        .update(readFileSync(`deploy/scripts/${name}`))
        .digest("hex"),
    ).toBe(hash);
  },
);

it("keeps CI download verification identical after its transport boundary", () => {
  const production = readFileSync(
    "deploy/scripts/published-release.mjs",
    "utf8",
  );
  const ci = readFileSync("deploy/ci/published-release.mjs", "utf8");
  const marker = "  const version = validReleaseVersion";
  expect(ci.slice(ci.indexOf(marker))).toBe(
    production.slice(production.indexOf(marker)),
  );
  const entry = readFileSync("deploy/ci/update-e2e.mjs", "utf8");
  expect(entry).toContain('from "./published-release.mjs"');
  expect(entry).toContain('installed: `v${[1, 3, 5].join(".")}-rc.1`');
  for (const name of ["server-release", "server-update-validation"]) {
    const workflow = readFileSync(`.github/workflows/${name}.yml`, "utf8");
    expect(workflow).toContain("baseline: [legacy, installed]");
    expect(workflow).toContain("CI_UPDATE_BASELINE: ${{ matrix.baseline }}");
    expect(workflow).toContain('CI_UPDATE_BASELINE="$CI_UPDATE_BASELINE"');
  }
});

it.each([false, true])(
  "executes the real installed-bootstrap guard (mismatch=%s)",
  async (mismatch) => {
    const installer = readFileSync(
      "deploy/scripts/install-updater.mjs",
      "utf8",
    );
    const loop = installer.slice(
      installer.indexOf("for (const name of ["),
      installer.indexOf("// Syntax check"),
    );
    const checked = new Set<string>();
    const result = runInNewContext(`(async () => { ${loop} })()`, {
      source: "/source",
      bootstrap: "/installed",
      join,
      lstat: () => ({ isFile: () => true, uid: 0, mode: 0o644 }),
      readFile: (path: string) => {
        const name = path.slice(path.lastIndexOf("/") + 1);
        if (path.startsWith("/installed/")) checked.add(name);
        if (mismatch && path === "/installed/published-release.mjs")
          return Buffer.from("changed transport");
        return readFileSync(`deploy/scripts/${name}`);
      },
      slots: {
        atomic: () => {
          throw new Error("Must not overwrite installed bootstrap");
        },
      },
    }) as Promise<void>;
    if (mismatch)
      await expect(result).rejects.toThrow(
        "explicit bootstrap migration required",
      );
    else {
      await result;
      expect([...checked].sort()).toEqual(Object.keys(frozen).sort());
    }
  },
);
