import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yazl from "yazl";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultBinDirectory,
  defaultInstallDirectory,
  extractClientArchive,
} from "@latex-renderer/setup-core";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("cross-platform client installer", () => {
  it("selects native installation paths from the detected platform", () => {
    expect(
      defaultInstallDirectory({
        platform: "win32",
        home: "C:\\Users\\Alice",
        env: { LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local" },
      }),
    ).toBe("C:\\Users\\Alice\\AppData\\Local\\LaTeXRenderer");
    expect(
      defaultInstallDirectory({
        platform: "linux",
        home: "/home/alice",
        env: {},
      }),
    ).toBe("/home/alice/.local/share/latex-renderer");
    expect(
      defaultInstallDirectory({
        platform: "darwin",
        home: "/Users/alice",
        env: {},
      }),
    ).toBe("/Users/alice/Library/Application Support/LaTeXRenderer");
    expect(defaultBinDirectory({ home: "/home/alice", env: {} })).toBe(
      "/home/alice/.local/bin",
    );
  });

  it("extracts a verified relative payload without external ZIP tools", async () => {
    const root = await temporaryRoot();
    const archive = await zip([
      ["latex-renderer-client/app/latex-render.cjs", "client"],
      ["latex-renderer-client/bin/latex-render", "launcher"],
    ]);

    await extractClientArchive(archive, root);

    await expect(
      readFile(
        join(root, "latex-renderer-client", "app", "latex-render.cjs"),
        "utf8",
      ),
    ).resolves.toBe("client");
  });

  it("rejects traversal and central/local filename disagreement", async () => {
    const archive = await zip([
      ["latex-renderer-client/app/latex-render.cjs", "client"],
    ]);
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(central).toBeGreaterThanOrEqual(0);
    const unsafe = Buffer.from(archive);
    unsafe.write("../", central + 46, "utf8");

    await expect(
      extractClientArchive(unsafe, await temporaryRoot()),
    ).rejects.toThrow("Unsafe client archive entry");

    const mismatch = Buffer.from(archive);
    mismatch.write("X", 30, "utf8");
    await expect(
      extractClientArchive(mismatch, await temporaryRoot()),
    ).rejects.toThrow("local and central headers do not match");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "latex-client-install-test-"));
  temporaryRoots.push(root);
  return root;
}

function zip(
  entries: ReadonlyArray<readonly [string, string]>,
): Promise<Buffer> {
  const archive = new yazl.ZipFile();
  for (const [name, value] of entries)
    archive.addBuffer(Buffer.from(value), name, {
      mtime: new Date("1980-01-01T00:00:00Z"),
      mode: 0o644,
    });
  archive.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
