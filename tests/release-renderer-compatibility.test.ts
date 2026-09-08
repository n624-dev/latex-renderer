import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  RENDERER_RUNTIME_FILES,
  RELEASE_RENDERER_FILES_V2,
  legacyReleaseRendererFingerprint,
  rendererRuntimeFingerprint,
  validatedReleaseRendererFingerprint,
} from "../deploy/scripts/runtime-image-identity.mjs";

const roots: string[] = [];
it("pins the unmodified RC.3 verifier and wires both new updater paths", async () => {
  const old = await readFile("tests/fixtures/rc3-runtime-image-identity.mjs");
  expect(createHash("sha256").update(old).digest("hex")).toBe(
    "fd80b642ca63d6be17ca3e38e453328ff74502dba5db604f8d6a7aff83c28903",
  );
  for (const file of ["update-manager.mjs", "update-manager-helper.mjs"]) {
    const source = await readFile(`deploy/scripts/${file}`, "utf8");
    expect(source).toContain("await validatedReleaseRendererFingerprint(");
  }
});
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "release-identity-"));
  roots.push(root);
  for (const file of RENDERER_RUNTIME_FILES)
    await writeFile(join(root, file), file);
  return root;
}
// Unmodified module from the installed RC.3 (e255febd0d00), including its CLI.
function oldUpdaterHash(root: string) {
  return execFileSync(
    process.execPath,
    [
      resolve("tests/fixtures/rc3-runtime-image-identity.mjs"),
      "--renderer-fingerprint",
    ],
    {
      env: { ...process.env, RENDERER_RUNTIME_SOURCE: root },
      encoding: "utf8",
    },
  ).trim();
}
async function manifest(root: string) {
  return {
    version: "1.3.4-rc.5",
    rendererRuntimeFingerprint: await legacyReleaseRendererFingerprint(root),
    rendererRuntimeIdentity: {
      schemaVersion: 2,
      fingerprint: await rendererRuntimeFingerprint(root),
    },
  };
}
it("reproduces RC.3 rejecting the unversioned RC.4 fingerprint", async () => {
  const root = await fixture();
  expect(oldUpdaterHash(root)).not.toBe(await rendererRuntimeFingerprint(root));
});
it("RC.3 and both new updater paths accept the dual identity contract", async () => {
  const root = await fixture(),
    m = await manifest(root);
  expect(oldUpdaterHash(root)).toBe(m.rendererRuntimeFingerprint);
  expect(await validatedReleaseRendererFingerprint(root, m)).toBe(
    m.rendererRuntimeFingerprint,
  );
  expect(RELEASE_RENDERER_FILES_V2).toEqual(RENDERER_RUNTIME_FILES);
});
it("keeps the added helper in Runtime identity and rejects its mutation", async () => {
  const root = await fixture(),
    m = await manifest(root);
  const archiveDigest = () =>
    createHash("sha256")
      .update(execFileSync("tar", ["-czf", "-", "-C", root, "."]))
      .digest("hex");
  const originalAssetDigest = archiveDigest();
  await writeFile(join(root, "install-language-packages.sh"), "tampered");
  expect(oldUpdaterHash(root)).toBe(m.rendererRuntimeFingerprint);
  expect(await rendererRuntimeFingerprint(root)).not.toBe(
    m.rendererRuntimeIdentity.fingerprint,
  );
  await expect(validatedReleaseRendererFingerprint(root, m)).rejects.toThrow(
    "identity mismatch",
  );
  // Legacy field is not an archive authenticator: the immutable asset digest
  // and provenance still cover helper bytes even on the old updater.
  expect(archiveDigest()).not.toBe(originalAssetDigest);
});
it("rejects missing helpers and changed original Renderer files", async () => {
  const root = await fixture(),
    m = await manifest(root);
  await writeFile(join(root, "compile.sh"), "changed");
  expect(oldUpdaterHash(root)).not.toBe(m.rendererRuntimeFingerprint);
  await expect(validatedReleaseRendererFingerprint(root, m)).rejects.toThrow();
  await rm(join(root, "install-language-packages.sh"));
  await expect(validatedReleaseRendererFingerprint(root, m)).rejects.toThrow();
});
it("requires the new identity from RC.5 onward and rejects unknown schemas", async () => {
  const root = await fixture(),
    m = await manifest(root);
  for (const version of ["1.3.4-rc.5", "1.3.4", "2.0.0"]) {
    await expect(
      validatedReleaseRendererFingerprint(root, { version }),
    ).rejects.toThrow("required");
  }
  await expect(
    validatedReleaseRendererFingerprint(root, {
      ...m,
      rendererRuntimeIdentity: null,
    }),
  ).rejects.toThrow();
  await expect(
    validatedReleaseRendererFingerprint(root, {
      ...m,
      rendererRuntimeIdentity: {
        schemaVersion: 3,
        fingerprint: m.rendererRuntimeIdentity.fingerprint,
      },
    }),
  ).rejects.toThrow("unsupported schema");
});
it("retains the two historically published metadata formats", async () => {
  const root = await fixture();
  expect(
    await validatedReleaseRendererFingerprint(root, { version: "1.3.4-rc.4" }),
  ).toBe(await rendererRuntimeFingerprint(root));
  await rm(join(root, "install-language-packages.sh"));
  expect(
    await validatedReleaseRendererFingerprint(root, { version: "1.3.4-rc.3" }),
  ).toBe(oldUpdaterHash(root));
});
