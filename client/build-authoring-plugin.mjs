import { Buffer } from "node:buffer";
import { log } from "node:console";
import process from "node:process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(repository, "integrations/latex-renderer");
const { version } = JSON.parse(
  await readFile(join(repository, "package.json"), "utf8"),
);
const output = join(repository, "client-dist");
const archive = join(output, `latex-renderer-authoring-plugin-${version}.zip`);
const temp = `${archive}.${process.pid}.tmp`;
const publicOrigin = "https://latex-render.n624.jp";
const manifest = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "latex-renderer",
  version,
  description:
    "Write, revise, render, and check LaTeX documents with LaTeX Renderer.",
  author: { name: "n624-dev", url: "https://github.com/n624-dev" },
  homepage: publicOrigin,
  repository: "https://github.com/n624-dev/latex-renderer",
  license: "Apache-2.0",
};
const mcp = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  mcpServers: {
    "latex-renderer": {
      type: "streamable-http",
      url: `${publicOrigin}/mcp`,
      extensions: {
        "com.openai": {
          auth: {
            type: "oauth",
            client: { mode: "dcr" },
            defaultScopes: ["mcp", "mcp:read", "mcp:render"],
          },
        },
      },
    },
  },
};
const zip = new yazl.ZipFile();
const options = { mode: 0o644, mtime: new Date("1980-01-01T00:00:00Z") };
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
zip.addBuffer(json(manifest), "plugin.json", options);
zip.addBuffer(json(mcp), "mcp.json", options);
for (const path of await files(skill)) {
  zip.addFile(
    path,
    `skills/latex-renderer/${relative(skill, path).replaceAll("\\", "/")}`,
    options,
  );
}
await mkdir(output, { recursive: true });
const result = pipeline(
  zip.outputStream,
  createWriteStream(temp, { flags: "wx", mode: 0o644 }),
);
zip.end();
try {
  await result;
  await rename(temp, archive);
} finally {
  await rm(temp, { force: true });
}
log(relative(repository, archive));

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await files(path)));
    else if (entry.isFile()) paths.push(path);
    else throw new Error("Unexpected file type in the authoring Skill");
  }
  return paths.sort();
}
