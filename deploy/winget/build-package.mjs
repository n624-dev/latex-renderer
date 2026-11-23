import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, URL } from "node:url";
import yauzl from "yauzl";
import yazl from "yazl";
import { validReleaseVersion } from "../scripts/release-version.mjs";

const [arch, input, output] = process.argv.slice(2);
if (!["x64", "arm64"].includes(arch) || !input || !output)
  throw new Error(
    "Usage: build-package.mjs x64|arm64 CLIENT_DIRECTORY OUTPUT_DIRECTORY",
  );

const version = validReleaseVersion(
  await readFile(join(input, "VERSION"), "utf8").then((value) => value.trim()),
);
const nodeRuntime = JSON.parse(
  await readFile(new URL("./runtime.json", import.meta.url), "utf8"),
);
const runtimeName = `node-v${nodeRuntime.version}-win-${arch}`;
const work = await mkdtemp(join(tmpdir(), "n624-winget-"));
try {
  const payload = join(work, "payload");
  const runtime = join(payload, "runtime");
  await mkdir(runtime, { recursive: true });
  const archivePath = join(work, "node.zip");
  const response = await globalThis.fetch(
    `https://nodejs.org/dist/v${nodeRuntime.version}/${runtimeName}.zip`,
    {
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(180_000),
    },
  );
  if (!response.ok || !response.body)
    throw new Error(`Node.js download failed (${response.status})`);
  await pipeline(
    response.body,
    createWriteStream(archivePath, { flags: "wx" }),
  );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
  if (hash.digest("hex") !== nodeRuntime.sha256[arch])
    throw new Error("The Windows Node.js runtime hash did not match");
  await extractRuntime(archivePath, runtimeName, runtime);

  await cp(join(input, "app"), join(payload, "app"), { recursive: true });
  await cp(join(input, "skill"), join(payload, "skill"), { recursive: true });
  await cp(join(input, "VERSION"), join(payload, "VERSION"));
  await cp(join(input, "README.md"), join(payload, "README.md"));
  await cp(
    fileURLToPath(new URL("../../LICENSE", import.meta.url)),
    join(payload, "LICENSE"),
  );
  const launcher = join(payload, "n624-latex.exe");
  execFileSync(
    "go",
    [
      "build",
      "-trimpath",
      "-ldflags=-s -w",
      "-o",
      launcher,
      fileURLToPath(new URL("./launcher.go", import.meta.url)),
    ],
    {
      env: {
        ...process.env,
        GOOS: "windows",
        GOARCH: arch === "x64" ? "amd64" : arch,
        CGO_ENABLED: "0",
        GOTOOLCHAIN: "local",
      },
      stdio: "inherit",
    },
  );
  for (const name of [
    "latex-render.exe",
    "latex-renderer-mcp.exe",
    "latex-render-admin.exe",
  ])
    await cp(launcher, join(payload, name));

  await mkdir(output, { recursive: true });
  const destination = resolve(
    output,
    `n624-latex-${version}-windows-${arch}.zip`,
  );
  const zip = new yazl.ZipFile();
  await addFiles(zip, payload, payload);
  const completed = pipeline(
    zip.outputStream,
    createWriteStream(destination, { flags: "wx" }),
  );
  zip.end();
  await completed;
  console.log(destination);
} finally {
  await rm(work, { recursive: true, force: true });
}

async function addFiles(zip, root, directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await addFiles(zip, root, path);
    else if (entry.isFile())
      zip.addFile(path, relative(root, path).replaceAll("\\", "/"), {
        mtime: new Date("2000-01-01T00:00:00Z"),
      });
    else throw new Error(`Unexpected Windows package entry ${entry.name}`);
  }
}

async function extractRuntime(archive, prefix, runtime) {
  const required = new Set(["node.exe", "LICENSE"]);
  const zip = await yauzl.openPromise(archive, { lazyEntries: true });
  try {
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName.slice(prefix.length + 1);
      if (!entry.fileName.startsWith(prefix + "/") || !required.has(name))
        continue;
      await pipeline(
        await zip.openReadStreamPromise(entry),
        createWriteStream(join(runtime, name), { flags: "wx" }),
      );
      required.delete(name);
    }
    if (required.size) throw new Error("Windows Node.js archive is incomplete");
  } finally {
    if (zip.isOpen) zip.close();
  }
}
