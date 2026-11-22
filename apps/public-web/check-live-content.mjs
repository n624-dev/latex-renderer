import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

const origin = new URL(process.argv[2]);
const client = await readManifest("manifest.json");
const mcpb = await readManifest("mcpb.json");
const docs = await readdir(new URL("./dist/docs/", import.meta.url), {
  withFileTypes: true,
});
const routes = [
  "/docs/",
  ...docs
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => `/docs/${name}/`),
];

for (const route of routes) {
  const expected = await readFile(
    new URL(`./dist${route}index.html`, import.meta.url),
    "utf8",
  );
  const heading = /<h1>[^<]+<\/h1>/.exec(expected)?.[0];
  const html = await (await request(route)).text();
  if (!heading || !html.includes(heading))
    throw new Error(`Unexpected guide title at ${route}`);
}

const clientGuide = await (await request("/docs/client/")).text();
if (
  !clientGuide.includes(
    'href="https://apt.n624.jp/latex-renderer/n624-latex.sources"',
  )
)
  throw new Error("The public client guide is missing the APT enrollment link");
const selfHosting = await (await request("/docs/self-hosting/")).text();
if (!selfHosting.includes("sudo n624-latex server setup"))
  throw new Error("The public self-hosting guide is missing the setup command");

const downloads = await (await request("/downloads/")).text();
for (const text of [
  `クライアント ${client.version}`,
  "Debian・Ubuntu に APT でインストール",
]) {
  if (!downloads.includes(text))
    throw new Error(`Download page is missing ${text}`);
}
for (const [route, metadataRoute, expected] of [
  ["/downloads/client/latest.zip", "/downloads/client/manifest.json", client],
  ["/downloads/mcpb/latest.mcpb", "/downloads/mcpb/mcpb.json", mcpb],
]) {
  const metadata = await (await request(metadataRoute)).json();
  for (const field of ["version", "archive", "size", "sha256"]) {
    if (metadata[field] !== expected[field])
      throw new Error(`${metadataRoute} has an unexpected ${field}`);
  }
  await verifyDownload(route, expected);
  await verifyDownload(
    new URL(expected.archive, new URL(route, origin)).pathname,
    expected,
  );
}
for (const name of [
  "install.mjs",
  "uninstall.mjs",
  "install.ps1",
  "uninstall.ps1",
]) {
  const bytes = await readFile(
    new URL(`../../client-dist/${name}`, import.meta.url),
  );
  await verifyDownload(
    `/downloads/${name.endsWith(".ps1") ? "windows" : "client"}/${name}`,
    {
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  );
}

globalThis.console.log(
  `Verified ${routes.length} public guides and the exact v${client.version} client assets.`,
);

async function verifyDownload(route, expected) {
  const response = await request(route);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > expected.size)
      throw new Error(`${route} is larger than the verified asset`);
    hash.update(chunk);
  }
  if (size !== expected.size || hash.digest("hex") !== expected.sha256)
    throw new Error(`${route} differs from the verified Stable asset`);
}

async function readManifest(name) {
  return JSON.parse(
    await readFile(
      new URL(`../../client-dist/${name}`, import.meta.url),
      "utf8",
    ),
  );
}

async function request(route) {
  const url = new URL(route, origin);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await globalThis.fetch(url, {
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(15_000),
    });
    if (
      response.ok &&
      response.headers.get("x-latex-renderer-serving") === "workers-static"
    )
      return response;
    await response.body?.cancel();
    if (attempt === 5)
      throw new Error(
        `${route} did not reach the static Worker (HTTP ${response.status})`,
      );
    await delay(2_000);
  }
}
