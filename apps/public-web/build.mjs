import { Buffer } from "node:buffer";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { loadClientDistribution } from "@latex-renderer/web/client-distribution";
import { createPublicStaticAssets } from "@latex-renderer/web/static-site";

const outputDirectory = fileURLToPath(new URL("./dist/", import.meta.url));
const clientDistributionDirectory = fileURLToPath(
  new URL("../../client-dist/", import.meta.url),
);
const maximumAssetBytes = 25 * 1024 * 1024;
const distribution = loadClientDistribution(clientDistributionDirectory);

await rm(outputDirectory, { recursive: true, force: true });

for (const asset of createPublicStaticAssets(distribution)) {
  const size =
    typeof asset.content === "string"
      ? Buffer.byteLength(asset.content, "utf8")
      : asset.content.byteLength;
  if (size > maximumAssetBytes) {
    throw new Error(
      `Static asset exceeds the Workers 25 MiB limit: ${asset.path}`,
    );
  }
  const destination = join(outputDirectory, asset.path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(
    destination,
    asset.content,
    typeof asset.content === "string" ? "utf8" : undefined,
  );
}
