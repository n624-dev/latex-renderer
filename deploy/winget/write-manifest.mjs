import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  validReleaseVersion,
  validStableVersion,
} from "../scripts/release-version.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "test-origin": { type: "string" },
    "test-version": { type: "string" },
    "test-architecture": { type: "string" },
  },
});

const [version, archiveDirectory, manifestDirectory] = positionals;
if (positionals.length !== 3 || !archiveDirectory || !manifestDirectory) {
  throw new Error(
    "Usage: write-manifest.mjs VERSION ARCHIVE_DIRECTORY MANIFEST_DIRECTORY",
  );
}

const repository = "https://github.com/n624-dev/latex-renderer";
const architectures = ["x64", "arm64"];
const commands = [
  "n624-latex",
  "latex-render",
  "latex-renderer-mcp",
  "latex-render-admin",
];
const schemaVersion = "1.9.0";
const testing = Object.keys(values).length > 0;
let identifier = "n624-dev.n624-latex";
let packageVersion = version;
let installerArchitectures = architectures;
let assetOrigin = `${repository}/releases/download/v${version}/`;
if (testing) {
  validReleaseVersion(version);
  const origin = values["test-origin"];
  const revision = values["test-version"];
  const architecture = values["test-architecture"];
  if (
    !origin ||
    !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/$/.test(origin) ||
    !revision ||
    !/^0\.0\.[12]$/.test(revision) ||
    !architectures.includes(architecture)
  ) {
    throw new Error(
      "Test manifests require a loopback origin, test version 0.0.1 or 0.0.2, and a native architecture",
    );
  }
  identifier += ".CI";
  packageVersion = revision;
  installerArchitectures = [architecture];
  assetOrigin = origin;
} else {
  validStableVersion(version);
}

const common = `PackageIdentifier: ${identifier}
PackageVersion: ${packageVersion}`;
const installers = [];
for (const architecture of installerArchitectures) {
  const name = `n624-latex-${version}-windows-${architecture}.zip`;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(archiveDirectory, name))) {
    hash.update(chunk);
  }
  installers.push(`- Architecture: ${architecture}
  InstallerUrl: ${assetOrigin}${name}
  InstallerSha256: ${hash.digest("hex").toUpperCase()}`);
}

function manifest(type, body) {
  return `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.${schemaVersion}.schema.json

${common}
${body}
ManifestType: ${type}
ManifestVersion: ${schemaVersion}
`;
}

await mkdir(manifestDirectory, { recursive: true });
for (const [suffix, contents] of [
  [".yaml", manifest("version", "DefaultLocale: en-US")],
  [
    ".installer.yaml",
    manifest(
      "installer",
      `InstallerType: zip
NestedInstallerType: portable
NestedInstallerFiles:
${commands
  .map(
    (name) => `- RelativeFilePath: ${name}.exe
  PortableCommandAlias: ${name}`,
  )
  .join("\n")}
Scope: user
InstallModes:
- silent
- silentWithProgress
Installers:
${installers.join("\n")}`,
    ),
  ],
  [
    ".locale.en-US.yaml",
    manifest(
      "defaultLocale",
      `PackageLocale: en-US
Publisher: n624-dev
PublisherUrl: https://github.com/n624-dev
PublisherSupportUrl: ${repository}/issues
PackageName: ${testing ? "n624-latex CI fixture" : "n624-latex"}
PackageUrl: ${repository}
License: Apache-2.0
LicenseUrl: ${repository}/blob/v${version}/LICENSE
ShortDescription: Render local LaTeX projects as PDFs through a LaTeX Renderer server.
Moniker: ${testing ? "n624-latex-ci" : "n624-latex"}
Tags:
- latex
- pdf
- tex
ReleaseNotesUrl: ${repository}/releases/tag/v${version}`,
    ),
  ],
]) {
  await writeFile(join(manifestDirectory, `${identifier}${suffix}`), contents, {
    flag: "wx",
  });
}
