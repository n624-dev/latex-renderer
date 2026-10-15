import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { isMainModule } from "./is-main-module.mjs";

export const baseRepository = "ghcr.io/n624-dev/latex-renderer-texlive";
const imagePath = baseRepository.slice("ghcr.io/".length);
const imageTypes = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
];
const indexTypes = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
];
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const architectures = ["amd64", "arm64"];
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function dateTag(value) {
  if (
    !/^2026-\d{2}-\d{2}$/.test(value ?? "") ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error("A supported canonical date is required");
  return value;
}

function descriptor(value) {
  if (
    !value ||
    !imageTypes.includes(value.mediaType) ||
    !digestPattern.test(value.digest ?? "") ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > 2 * 1024 ** 2
  )
    throw new Error("Invalid Base manifest descriptor");
  return { mediaType: value.mediaType, digest: value.digest, size: value.size };
}

export function basePlatforms(manifest) {
  if (
    manifest?.schemaVersion !== 2 ||
    !indexTypes.includes(manifest.mediaType) ||
    !Array.isArray(manifest.manifests) ||
    manifest.manifests.length !== 2
  )
    throw new Error("Base index must contain exactly amd64 and arm64");
  const selected = {};
  for (const item of manifest.manifests) {
    const arch = item?.platform?.architecture;
    if (
      !architectures.includes(arch) ||
      item.platform.os !== "linux" ||
      (item.platform.variant &&
        !(arch === "arm64" && item.platform.variant === "v8")) ||
      selected[arch]
    )
      throw new Error("Unexpected or duplicate Base platform");
    selected[arch] = {
      ...descriptor(item),
      platform: { os: "linux", architecture: arch },
    };
  }
  if (selected.amd64.digest === selected.arm64.digest)
    throw new Error("Base platforms must have distinct manifests");
  return selected;
}

// Metadata only, with bounded bodies/timeouts. Only an actual manifest 404
// means absent; auth, rate limiting and network failures must stop publication.
export function registryClient({
  fetchImpl = globalThis.fetch,
  actor,
  token,
} = {}) {
  let bearer;
  async function authorization() {
    if (bearer) return bearer;
    if (Boolean(actor) !== Boolean(token))
      throw new Error("Partial registry credentials");
    const response = await fetchImpl(
      `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(`repository:${imagePath}:${token ? "pull,push" : "pull"}`)}`,
      {
        headers: token
          ? {
              Authorization: `Basic ${Buffer.from(`${actor}:${token}`).toString("base64")}`,
            }
          : {},
        signal: globalThis.AbortSignal.timeout(30_000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new Error(`Registry authorization failed: HTTP ${response.status}`);
    const data = JSON.parse(await boundedBody(response));
    if (
      typeof data.token !== "string" ||
      !data.token ||
      data.token.length > 16_384
    )
      throw new Error("Invalid registry authorization");
    bearer = data.token;
    return bearer;
  }
  async function request(path, options = {}) {
    return fetchImpl(`https://ghcr.io/v2/${imagePath}/${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${await authorization()}`,
      },
      signal: globalThis.AbortSignal.timeout(30_000),
      redirect: options.redirect ?? "error",
    });
  }
  return {
    async manifest(reference) {
      if (
        !digestPattern.test(reference) &&
        !/^2026-\d{2}-\d{2}$/.test(reference) &&
        reference !== "latest"
      )
        throw new Error("Unsafe registry reference");
      const response = await request(`manifests/${reference}`, {
        headers: { Accept: [...imageTypes, ...indexTypes].join(", ") },
      });
      if (response.status === 404) return null;
      if (!response.ok)
        throw new Error(`Registry manifest failed: HTTP ${response.status}`);
      const bytes = await boundedBody(response),
        digest = hash(bytes);
      if (
        response.headers.get("docker-content-digest") !== digest ||
        (digestPattern.test(reference) && reference !== digest)
      )
        throw new Error("Registry manifest digest mismatch");
      const manifest = JSON.parse(bytes);
      if (
        manifest.schemaVersion !== 2 ||
        ![...imageTypes, ...indexTypes].includes(manifest.mediaType)
      )
        throw new Error("Unsupported registry manifest");
      return { manifest, digest, bytes, size: Buffer.byteLength(bytes) };
    },
    async config(digest) {
      if (!digestPattern.test(digest)) throw new Error("Invalid config digest");
      let response = await request(`blobs/${digest}`, { redirect: "manual" });
      if ([302, 307].includes(response.status)) {
        const location = new globalThis.URL(
          response.headers.get("location") ?? "",
        );
        if (
          location.protocol !== "https:" ||
          location.hostname !== "pkg-containers.githubusercontent.com" ||
          location.port ||
          location.username ||
          location.password ||
          location.hash
        )
          throw new Error("Unexpected registry config redirect");
        // The CDN URL is signed. Never forward the registry Bearer credential
        // (or write Basic credential) to a different origin.
        response = await fetchImpl(location, {
          signal: globalThis.AbortSignal.timeout(30_000),
          redirect: "error",
        });
      }
      if (!response.ok)
        throw new Error(`Registry config failed: HTTP ${response.status}`);
      const bytes = await boundedBody(response);
      if (hash(bytes) !== digest)
        throw new Error("Registry config digest mismatch");
      return JSON.parse(bytes);
    },
    async put(tag, bytes) {
      if (!token) throw new Error("Registry writes require credentials");
      if (tag !== "latest") dateTag(tag);
      basePlatforms(JSON.parse(bytes));
      const response = await request(`manifests/${tag}`, {
        method: "PUT",
        body: bytes,
        headers: { "Content-Type": "application/vnd.oci.image.index.v1+json" },
      });
      if (
        response.status !== 201 ||
        response.headers.get("docker-content-digest") !== hash(bytes)
      )
        throw new Error(
          `Registry index write not confirmed: HTTP ${response.status}`,
        );
    },
  };
}

async function boundedBody(response) {
  if (Number(response.headers.get("content-length")) > 2 * 1024 ** 2)
    throw new Error("Oversized registry metadata");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > 2 * 1024 ** 2) throw new Error("Oversized registry metadata");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function planBase(date, registry = registryClient()) {
  dateTag(date);
  const found = await registry.manifest(date);
  if (!found)
    return { mode: "create", digest: "", architectures, manifests: {} };
  if (indexTypes.includes(found.manifest.mediaType))
    return {
      mode: "reuse",
      digest: found.digest,
      architectures,
      manifests: basePlatforms(found.manifest),
    };
  const config = await registry.config(found.manifest.config?.digest);
  if (config.os !== "linux" || config.architecture !== "amd64")
    throw new Error("Unexpected legacy Base architecture");
  return {
    mode: "legacy",
    digest: found.digest,
    architectures: ["amd64"],
    manifests: {
      amd64: {
        ...descriptor({
          ...found.manifest,
          digest: found.digest,
          size: found.size,
        }),
        platform: { os: "linux", architecture: "amd64" },
      },
    },
  };
}

export async function nativeBaseDigest(arch, registry = registryClient()) {
  if (!architectures.includes(arch))
    throw new Error("Unsupported native Base architecture");
  const latest = await registry.manifest("latest");
  if (!latest) throw new Error("No published Base is available");
  let component = latest;
  if (indexTypes.includes(latest.manifest.mediaType)) {
    const selected = basePlatforms(latest.manifest)[arch];
    component = await registry.manifest(selected.digest);
    if (!component || component.size !== selected.size)
      throw new Error("Published native Base is missing");
  } else if (arch !== "amd64")
    throw new Error(
      "Publish and anonymously verify a new dual-native Base before ARM host acceptance",
    );
  const config = await registry.config(component.manifest.config?.digest);
  const labels = config.config?.Labels;
  const canonical = labels?.["jp.n624.latex-renderer.texlive.repository"];
  const installer = labels?.["jp.n624.latex-renderer.texlive.installer-sha512"];
  const date =
    /^https:\/\/texlive\.info\/tlnet-archive\/(2026)\/(\d{2})\/(\d{2})\/tlnet$/.exec(
      canonical ?? "",
    );
  if (!date || !/^[a-f0-9]{128}$/.test(installer ?? ""))
    throw new Error("Published Base provenance is invalid");
  dateTag(date.slice(1).join("-"));
  verifyBaseConfig(config, arch, { canonical, installer });
  return latest.digest;
}

function identity(expected) {
  dateTag(expected.date);
  if (
    !/^[a-f0-9]{128}$/.test(expected.installer ?? "") ||
    !/^[a-f0-9]{40}$/.test(expected.commit ?? "") ||
    !/^\d+$/.test(expected.runId ?? "") ||
    !/^[1-9]\d*$/.test(expected.attempt ?? "")
  )
    throw new Error("Invalid publication identity");
  const canonical = `https://texlive.info/tlnet-archive/${expected.date.replaceAll("-", "/")}/tlnet`;
  if (expected.canonical !== canonical)
    throw new Error("Noncanonical Base repository");
  return {
    date: expected.date,
    installer: expected.installer,
    canonical,
    commit: expected.commit,
    runId: expected.runId,
    attempt: expected.attempt,
  };
}

export function verifyBaseConfig(config, arch, expected) {
  const labels = config?.config?.Labels;
  if (
    !architectures.includes(arch) ||
    config?.os !== "linux" ||
    config.architecture !== arch ||
    labels?.["org.opencontainers.image.title"] !== "latex-renderer-texlive" ||
    labels["jp.n624.latex-renderer.texlive.profile-kind"] !==
      "language-neutral-maximal" ||
    labels["jp.n624.latex-renderer.base-kind"] !== "texlive-only-v1" ||
    labels["jp.n624.latex-renderer.texlive.repository"] !==
      expected.canonical ||
    labels["jp.n624.latex-renderer.texlive.installer-sha512"] !==
      expected.installer ||
    labels["jp.n624.latex-renderer.runtime-kind"] ||
    labels["jp.n624.latex-renderer.languages"]
  )
    throw new Error("Base platform/provenance mismatch or Runtime selected");
}

export function publicationIndex(records, expected) {
  const pin = identity(expected);
  if (!Array.isArray(records) || records.length !== 2)
    throw new Error("Both native validation receipts are required");
  const selected = {};
  for (const record of records) {
    if (
      record?.schema !== 1 ||
      record.validated !== true ||
      !architectures.includes(record.architecture) ||
      selected[record.architecture] ||
      !digestPattern.test(record.imageId ?? "") ||
      Object.entries(pin).some(([key, value]) => record[key] !== value)
    )
      throw new Error("Stale, duplicate or mismatched validation receipt");
    selected[record.architecture] = {
      ...descriptor(record.manifest),
      platform: { os: "linux", architecture: record.architecture },
    };
  }
  const result = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: architectures.map((arch) => selected[arch]),
  };
  basePlatforms(result);
  return JSON.stringify(result);
}

export async function publishBase(
  records,
  expected,
  registry = registryClient(),
) {
  const bytes = publicationIndex(records, expected),
    digest = hash(bytes);
  // All jobs use the same workflow concurrency group. A changed date tag is
  // never repaired/overwritten; require a fresh run and revalidation instead.
  const before = await registry.manifest(expected.date);
  if (before) {
    const platforms = basePlatforms(before.manifest);
    for (const record of records)
      if (
        JSON.stringify(platforms[record.architecture]) !==
        JSON.stringify({
          ...descriptor(record.manifest),
          platform: { os: "linux", architecture: record.architecture },
        })
      )
        throw new Error("Immutable date changed since validation");
    return before.digest;
  }
  for (const record of records) {
    const remote = await registry.manifest(record.manifest.digest);
    if (
      !remote ||
      remote.size !== record.manifest.size ||
      remote.manifest.mediaType !== record.manifest.mediaType ||
      remote.manifest.config?.digest !== record.imageId
    )
      throw new Error("Uploaded Base does not match validation receipt");
    verifyBaseConfig(
      await registry.config(record.imageId),
      record.architecture,
      expected,
    );
  }
  if (await registry.manifest(expected.date))
    throw new Error(
      "Immutable date appeared during publication; retry validation",
    );
  await registry.put(expected.date, bytes);
  if ((await registry.manifest(expected.date))?.digest !== digest)
    throw new Error("Published date digest not confirmed");
  return digest;
}

const execute = (program, args, options = {}) =>
  execFileSync(program, args, {
    stdio: "inherit",
    timeout: 1_200_000,
    ...options,
  });
export async function stageBase(
  base,
  arch,
  expected,
  existingDigest,
  publish,
  registry,
  {
    run = execute,
    temporaryRoot = process.env.RUNNER_TEMP,
    space = statfs,
  } = {},
) {
  const pin = identity(expected);
  const local = JSON.parse(
    run("docker", ["image", "inspect", base, "--format", "{{json .}}"], {
      encoding: "utf8",
      stdio: "pipe",
    }),
  );
  verifyBaseConfig(
    { os: local.Os, architecture: local.Architecture, config: local.Config },
    arch,
    pin,
  );
  if (!digestPattern.test(local.Id))
    throw new Error("Invalid validated Base image ID");
  let manifest;
  if (existingDigest) {
    const remote = await registry.manifest(existingDigest);
    if (!remote || remote.manifest.config?.digest !== local.Id)
      throw new Error("Reused Base identity changed");
    manifest = descriptor({
      ...remote.manifest,
      digest: remote.digest,
      size: remote.size,
    });
  } else {
    const temporary = await mkdtemp(join(temporaryRoot, "base-transfer-"));
    try {
      const free = await space(temporary);
      if (
        !Number.isSafeInteger(local.Size) ||
        local.Size < 1 ||
        free.bavail * free.bsize < local.Size * 2 + 2 * 1024 ** 3
      )
        throw new Error("Insufficient peak disk space for Base transfer");
      const layout = join(temporary, "layout");
      run(
        "skopeo",
        [
          "copy",
          "--retry-times",
          "2",
          "--format",
          "v2s2",
          "--dest-compress",
          "--dest-compress-format",
          "gzip",
          "--dest-compress-level",
          "1",
          `docker-daemon:${local.Id}`,
          `dir:${layout}`,
        ],
        { env: { ...process.env, TMPDIR: temporary } },
      );
      const metadata = join(layout, "manifest.json"),
        info = await lstat(metadata);
      if (!info.isFile() || info.size > 2 * 1024 ** 2)
        throw new Error("Unbounded Base transfer manifest");
      const bytes = await readFile(metadata);
      const content = JSON.parse(bytes);
      manifest = descriptor({
        ...content,
        digest: hash(bytes),
        size: bytes.length,
      });
      if (
        content.schemaVersion !== 2 ||
        content.mediaType !==
          "application/vnd.docker.distribution.manifest.v2+json" ||
        content.config?.digest !== local.Id
      )
        throw new Error("Transfer changed validated Base");
      if (publish) {
        run(
          "skopeo",
          [
            "copy",
            "--retry-times",
            "2",
            "--preserve-digests",
            `dir:${layout}`,
            `docker://${baseRepository}@${manifest.digest}`,
          ],
          { env: { ...process.env, TMPDIR: temporary } },
        );
        const remote = await registry.manifest(manifest.digest);
        if (
          !remote ||
          remote.digest !== manifest.digest ||
          remote.manifest.config?.digest !== local.Id
        )
          throw new Error("Digest-only Base upload not confirmed");
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  return {
    schema: 1,
    validated: true,
    ...pin,
    architecture: arch,
    imageId: local.Id,
    manifest,
  };
}

async function main() {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.RUNNER_ENVIRONMENT !== "github-hosted"
  )
    throw new Error("Publication entry requires a disposable hosted runner");
  const [verb, argument, directory] = process.argv.slice(2);
  const expected = {
    date: process.env.SNAPSHOT_DATE,
    installer: process.env.TEXLIVE_INSTALLER_SHA512,
    canonical: process.env.TEXLIVE_REPOSITORY,
    commit: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
  };
  if (verb === "plan") {
    const plan = await planBase(argument);
    for (const [key, value] of Object.entries({
      mode: plan.mode,
      digest: plan.digest,
      architectures: JSON.stringify(plan.architectures),
      amd64_digest: plan.manifests.amd64?.digest ?? "",
      arm64_digest: plan.manifests.arm64?.digest ?? "",
    }))
      await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  } else if (verb === "stage") {
    const receipt = await stageBase(
      argument,
      process.env.CI_ARCHITECTURE,
      expected,
      process.env.EXISTING_MANIFEST_DIGEST,
      process.env.PUBLISH_REQUESTED === "true",
      registryClient(),
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `${receipt.architecture}.json`),
      JSON.stringify(receipt) + "\n",
      { flag: "wx" },
    );
  } else if (verb === "publish") {
    const records = [];
    for (const arch of architectures) {
      const path = join(argument, `${arch}.json`),
        info = await lstat(path);
      if (!info.isFile() || info.size > 16_384 || info.nlink !== 1)
        throw new Error("Invalid validation receipt file");
      records.push(JSON.parse(await readFile(path, "utf8")));
    }
    const digest = await publishBase(
      records,
      expected,
      registryClient({
        actor: process.env.GHCR_ACTOR,
        token: process.env.GHCR_TOKEN,
      }),
    );
    await appendFile(process.env.GITHUB_OUTPUT, `digest=${digest}\n`);
  } else if (verb === "promote") {
    if (!digestPattern.test(argument ?? ""))
      throw new Error("A verified index digest is required");
    const registry = registryClient({
      actor: process.env.GHCR_ACTOR,
      token: process.env.GHCR_TOKEN,
    });
    const index = await registry.manifest(argument);
    if (
      !index ||
      (await registry.manifest(dateTag(expected.date)))?.digest !== argument
    )
      throw new Error("Dated Base identity changed before promotion");
    basePlatforms(index.manifest);
    await registry.put("latest", index.bytes);
    if ((await registry.manifest("latest"))?.digest !== argument)
      throw new Error("Latest promotion digest not confirmed");
  } else
    throw new Error(
      "usage: ghcr-base-publication.mjs plan DATE | stage BASE RECEIPTS | publish RECEIPTS | promote DIGEST",
    );
}

if (isMainModule(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
