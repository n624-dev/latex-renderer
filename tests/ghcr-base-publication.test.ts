import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  basePlatforms,
  nativeBaseDigest,
  planBase,
  publicationIndex,
  publishBase,
  registryClient,
  stageBase,
  verifyBaseConfig,
  type Architecture,
  type Identity,
  type ImageConfig,
  type Manifest,
  type Receipt,
  type Registry,
} from "../deploy/scripts/ghcr-base-publication.mjs";

const hash = (bytes: string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const pin: Identity = {
  date: "2026-10-15",
  canonical: "https://texlive.info/tlnet-archive/2026/10/15/tlnet",
  installer: "b".repeat(128),
  commit: "c".repeat(40),
  runId: "123",
  attempt: "2",
};
const imageType = "application/vnd.oci.image.manifest.v1+json";
function config(architecture: Architecture): ImageConfig {
  return {
    os: "linux",
    architecture,
    config: {
      Labels: {
        "org.opencontainers.image.title": "latex-renderer-texlive",
        "jp.n624.latex-renderer.texlive.profile-kind":
          "language-neutral-maximal",
        "jp.n624.latex-renderer.base-kind": "texlive-only-v1",
        "jp.n624.latex-renderer.texlive.repository": pin.canonical,
        "jp.n624.latex-renderer.texlive.installer-sha512": pin.installer,
      },
    },
  };
}
function receipt(architecture: Architecture, mediaType = imageType): Receipt {
  const imageId = hash(JSON.stringify(config(architecture)));
  const bytes = JSON.stringify({
    schemaVersion: 2,
    mediaType,
    config: { digest: imageId },
  });
  return {
    schema: 1,
    validated: true,
    ...pin,
    architecture,
    imageId,
    manifest: {
      mediaType,
      digest: hash(bytes),
      size: Buffer.byteLength(bytes),
    },
  };
}
const receipts = () => [receipt("amd64"), receipt("arm64")];
function remote(bytes: string) {
  return {
    bytes,
    digest: hash(bytes),
    size: Buffer.byteLength(bytes),
    manifest: JSON.parse(bytes) as Manifest,
  };
}
function fixture() {
  const documents = new Map<string, string>();
  for (const record of receipts())
    documents.set(
      record.manifest.digest,
      JSON.stringify({
        schemaVersion: 2,
        mediaType: imageType,
        config: { digest: record.imageId },
      }),
    );
  const manifest = vi.fn<Registry["manifest"]>((reference) =>
    Promise.resolve(
      documents.has(reference) ? remote(documents.get(reference) ?? "") : null,
    ),
  );
  const put = vi.fn<Registry["put"]>((tag, bytes) => {
    documents.set(tag, bytes);
    return Promise.resolve();
  });
  const readConfig = vi.fn<Registry["config"]>((digest) => {
    for (const arch of ["amd64", "arm64"] as const)
      if (receipt(arch).imageId === digest)
        return Promise.resolve(config(arch));
    return Promise.reject(new Error("Unknown fixture config"));
  });
  return {
    registry: { manifest, put, config: readConfig },
    documents,
    put,
    manifest,
  };
}

describe("immutable dual-native Base publication", () => {
  it.each(["amd64", "arm64"] as const)(
    "pins the published index before provisioning the native %s host",
    async (arch) => {
      const { registry, documents } = fixture();
      const bytes = publicationIndex(receipts(), pin);
      documents.set("latest", bytes);
      expect(await nativeBaseDigest(arch, registry)).toBe(hash(bytes));
    },
  );
  it("refuses ARM provisioning against a legacy amd64-only latest", async () => {
    const { registry, documents } = fixture();
    documents.set(
      "latest",
      documents.get(receipt("amd64").manifest.digest) ?? "",
    );
    expect(await nativeBaseDigest("amd64", registry)).toBe(
      receipt("amd64").manifest.digest,
    );
    await expect(nativeBaseDigest("arm64", registry)).rejects.toThrow(
      "before ARM host acceptance",
    );
  });
  it("plans both native builds only for a new or already multi-platform date", async () => {
    const { registry, documents, put } = fixture();
    expect(await planBase(pin.date, registry)).toMatchObject({
      mode: "create",
      architectures: ["amd64", "arm64"],
    });
    documents.set(pin.date, publicationIndex(receipts(), pin));
    expect(await planBase(pin.date, registry)).toMatchObject({
      mode: "reuse",
      architectures: ["amd64", "arm64"],
    });
    expect(put).not.toHaveBeenCalled();
  });
  it("keeps existing amd64 dates immutable, with no ARM relabel or latest promotion", async () => {
    const { registry, documents, put } = fixture();
    documents.set(
      pin.date,
      documents.get(receipt("amd64").manifest.digest) ?? "",
    );
    expect(await planBase(pin.date, registry)).toMatchObject({
      mode: "legacy",
      architectures: ["amd64"],
    });
    await expect(publishBase(receipts(), pin, registry)).rejects.toThrow(
      "exactly amd64 and arm64",
    );
    expect(put).not.toHaveBeenCalled();
  });
  it("publishes one exact OCI index after checking both digest-only uploads and configs", async () => {
    const { registry, put } = fixture();
    const bytes = publicationIndex(receipts(), pin);
    expect(await publishBase(receipts().reverse(), pin, registry)).toBe(
      hash(bytes),
    );
    expect(put.mock.calls).toEqual([[pin.date, bytes]]);
    expect(registry.config).toHaveBeenCalledTimes(2);
    expect(put.mock.calls.every(([tag]) => tag !== "latest")).toBe(true);
    expect(await publishBase(receipts(), pin, registry)).toBe(hash(bytes));
    expect(put).toHaveBeenCalledTimes(1);
  });
  it.each([
    "date",
    "installer",
    "canonical",
    "commit",
    "runId",
    "attempt",
  ] as const)(
    "rejects another %s before any registry mutation",
    async (key) => {
      const { registry, put } = fixture();
      const records = receipts();
      const first = records[0];
      if (!first) throw new Error("Missing fixture");
      first[key] += "different";
      await expect(publishBase(records, pin, registry)).rejects.toThrow(
        "receipt",
      );
      expect(put).not.toHaveBeenCalled();
    },
  );
  it.each(
    [
      [],
      [receipt("amd64")],
      [receipt("amd64"), receipt("amd64")],
      [{ ...receipt("amd64"), validated: false }, receipt("arm64")],
      [{ ...receipt("amd64"), imageId: "local-tag" }, receipt("arm64")],
    ].map((records) => ({ records })),
  )("requires two unique successful native validations", ({ records }) => {
    expect(() => publicationIndex(records, pin)).toThrow();
  });
  it("does not recreate a changed immutable date", async () => {
    const { registry, documents, put } = fixture();
    const changed = receipts();
    if (!changed[0]) throw new Error("Missing fixture");
    changed[0].manifest.digest = `sha256:${"f".repeat(64)}`;
    documents.set(pin.date, publicationIndex(changed, pin));
    await expect(publishBase(receipts(), pin, registry)).rejects.toThrow(
      "Immutable date changed",
    );
    expect(put).not.toHaveBeenCalled();
  });
  it("fails closed if a date appears immediately before publication", async () => {
    const { registry, manifest, put } = fixture();
    const read = manifest.getMockImplementation();
    if (!read) throw new Error("Missing fixture");
    let dateReads = 0;
    manifest.mockImplementation((ref) =>
      ref === pin.date && ++dateReads === 2
        ? Promise.resolve(remote(publicationIndex(receipts(), pin)))
        : read(ref),
    );
    await expect(publishBase(receipts(), pin, registry)).rejects.toThrow(
      "appeared",
    );
    expect(put).not.toHaveBeenCalled();
  });
  it("does not publish with a missing or altered remote component", async () => {
    const { registry, documents, put } = fixture();
    documents.delete(receipt("arm64").manifest.digest);
    await expect(publishBase(receipts(), pin, registry)).rejects.toThrow(
      "receipt",
    );
    expect(put).not.toHaveBeenCalled();
  });
  it.each([
    "os",
    "architecture",
    "title",
    "kind",
    "repository",
    "installer",
    "runtime",
    "languages",
  ])("rejects mismatched Base %s", (field) => {
    const value = config("arm64");
    const labels = value.config.Labels;
    if (!labels) throw new Error("Missing labels");
    if (field === "os") value.os = "windows";
    else if (field === "architecture") value.architecture = "amd64";
    else
      labels[
        (
          {
            title: "org.opencontainers.image.title",
            kind: "jp.n624.latex-renderer.base-kind",
            repository: "jp.n624.latex-renderer.texlive.repository",
            installer: "jp.n624.latex-renderer.texlive.installer-sha512",
            runtime: "jp.n624.latex-renderer.runtime-kind",
            languages: "jp.n624.latex-renderer.languages",
          } as Record<string, string>
        )[field] ?? "invalid"
      ] = "wrong";
    expect(() => verifyBaseConfig(value, "arm64", pin)).toThrow();
  });
  it.each(["../outside", "2027-01-01", "2026-02-30", "2026-13-01"])(
    "rejects invalid date %s before network access",
    async (date) => {
      const { registry, manifest } = fixture();
      await expect(planBase(date, registry)).rejects.toThrow();
      expect(manifest).not.toHaveBeenCalled();
    },
  );
  it("rejects extra, duplicate, nested and malformed platforms", () => {
    const index = JSON.parse(publicationIndex(receipts(), pin)) as Manifest;
    for (const manifests of [
      [],
      [...(index.manifests ?? []), ...(index.manifests ?? [])],
      [
        {
          ...receipt("amd64").manifest,
          platform: { os: "linux", architecture: "amd64" },
        },
        {
          ...receipt("arm64").manifest,
          platform: { os: "linux", architecture: "amd64" },
        },
      ],
      [
        {
          ...receipt("amd64").manifest,
          platform: { os: "linux", architecture: "amd64" },
        },
        {
          ...receipt("arm64").manifest,
          platform: { os: "windows", architecture: "arm64" },
        },
      ],
    ])
      expect(() => basePlatforms({ ...index, manifests })).toThrow();
  });
});

describe("bounded registry metadata transport", () => {
  it.each([401, 403, 429, 500])(
    "does not treat HTTP %s as an absent date",
    async (status) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ token: "fixture" }))
        .mockResolvedValueOnce(new Response(null, { status }));
      await expect(
        planBase(pin.date, registryClient({ fetchImpl })),
      ).rejects.toThrow(`HTTP ${status}`);
    },
  );
  it("only manifest 404 means absent, and sends no write credentials during planning", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "fixture" }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(
      await planBase(pin.date, registryClient({ fetchImpl })),
    ).toMatchObject({ mode: "create" });
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({});
    expect(
      fetchImpl.mock.calls.every(
        ([, init]) =>
          init?.redirect === "error" && init.signal instanceof AbortSignal,
      ),
    ).toBe(true);
  });
  it("checks response bytes and requested digest, not just the status", async () => {
    const bytes = publicationIndex(receipts(), pin);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "fixture" }))
      .mockResolvedValueOnce(
        new Response(bytes, {
          headers: { "docker-content-digest": receipt("amd64").imageId },
        }),
      );
    await expect(
      registryClient({ fetchImpl }).manifest(pin.date),
    ).rejects.toThrow("digest mismatch");
  });
  it("bounds metadata even without Content-Length", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "fixture" }))
      .mockResolvedValueOnce(new Response("x".repeat(2 * 1024 ** 2 + 1)));
    await expect(
      registryClient({ fetchImpl }).manifest(pin.date),
    ).rejects.toThrow("Oversized");
  });
  it("requires authenticated confirmed index writes and never tags a Runtime", async () => {
    const bytes = publicationIndex(receipts(), pin);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "fixture" }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 201,
          headers: { "docker-content-digest": hash(bytes) },
        }),
      );
    await registryClient({ fetchImpl, actor: "fixture", token: "fixture" }).put(
      pin.date,
      bytes,
    );
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: "PUT",
      body: bytes,
      redirect: "error",
    });
    await expect(
      registryClient({ fetchImpl }).put(pin.date, bytes),
    ).rejects.toThrow("credentials");
    await expect(
      registryClient({ fetchImpl, actor: "fixture", token: "fixture" }).put(
        "runtime-v1-test",
        bytes,
      ),
    ).rejects.toThrow("date");
  });
  it("follows a signed GHCR config CDN URL without forwarding registry credentials", async () => {
    const bytes = JSON.stringify(config("arm64"));
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "fixture" }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: {
            location: "https://pkg-containers.githubusercontent.com/fixture",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(bytes));
    expect(await registryClient({ fetchImpl }).config(hash(bytes))).toEqual(
      config("arm64"),
    );
    expect(fetchImpl.mock.calls[2]?.[1]?.headers).toBeUndefined();
    expect(fetchImpl.mock.calls[2]?.[1]?.redirect).toBe("error");
  });
  it.each([
    "http://pkg-containers.githubusercontent.com/fixture",
    "https://example.invalid/fixture",
    "https://pkg-containers.githubusercontent.com:444/fixture",
    "https://user@pkg-containers.githubusercontent.com/fixture",
  ])("rejects unsafe config redirect %s", async (location) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "fixture" }))
      .mockResolvedValueOnce(
        new Response(null, { status: 307, headers: { location } }),
      );
    await expect(
      registryClient({ fetchImpl }).config(receipt("arm64").imageId),
    ).rejects.toThrow("redirect");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([200, 403, 429, 500])(
    "does not call an unconfirmed write successful (HTTP %s)",
    async (status) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ token: "fixture" }))
        .mockResolvedValueOnce(new Response(null, { status }));
      await expect(
        registryClient({ fetchImpl, actor: "fixture", token: "fixture" }).put(
          pin.date,
          publicationIndex(receipts(), pin),
        ),
      ).rejects.toThrow("not confirmed");
    },
  );
});

describe.skipIf(process.platform === "win32")(
  "actual staging entry with tiny OCI transfer fixtures",
  () => {
    it.each([
      "success",
      "copy-failed",
      "wrong-config",
      "bad-json",
      "enospc",
      "peak-blocked",
    ])("cleans staging and issues no receipt on %s", async (mode) => {
      const root = mkdtempSync(join(tmpdir(), "base-stage-fixture-"));
      try {
        const bin = join(root, "bin");
        mkdirSync(bin);
        const value = config("arm64"),
          imageId = receipt("arm64").imageId;
        writeFileSync(
          join(bin, "docker"),
          `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ Os: value.os, Architecture: value.architecture, Config: value.config, Id: imageId, Size: mode === "peak-blocked" ? Number.MAX_SAFE_INTEGER : 128 })}'\n`,
          { mode: 0o700 },
        );
        writeFileSync(
          join(bin, "skopeo"),
          `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
fs.appendFileSync(process.env.FIXTURE_TRACE,JSON.stringify(process.argv.slice(2))+'\\n');
if(['copy-failed','enospc'].includes(process.env.FIXTURE_MODE)) {process.stderr.write(process.env.FIXTURE_MODE==='enospc'?'ENOSPC':'copy failed');process.exit(1);}
const target=process.argv.at(-1).slice(4);fs.mkdirSync(target,{recursive:true});
const content={schemaVersion:2,mediaType:'application/vnd.docker.distribution.manifest.v2+json',config:{digest:process.env.FIXTURE_MODE==='wrong-config'?'sha256:'+'f'.repeat(64):${JSON.stringify(imageId)}}};
fs.writeFileSync(path.join(target,'manifest.json'),process.env.FIXTURE_MODE==='bad-json'?'{':JSON.stringify(content));
`,
          { mode: 0o700 },
        );
        const trace = join(root, "trace");
        writeFileSync(trace, "");
        const staged = stageBase(
          "fixture-base",
          "arm64",
          pin,
          "",
          false,
          fixture().registry,
          {
            temporaryRoot: root,
            space: () => Promise.resolve({ bavail: 12 * 1024 ** 3, bsize: 1 }),
            run: (program, args) =>
              execFileSync(join(bin, program), args, {
                encoding: "utf8",
                timeout: 10_000,
                env: {
                  ...process.env,
                  FIXTURE_MODE: mode,
                  FIXTURE_TRACE: trace,
                },
              }),
          },
        );
        if (mode === "success")
          await expect(staged).resolves.toMatchObject(
            receipt(
              "arm64",
              "application/vnd.docker.distribution.manifest.v2+json",
            ),
          );
        else
          await expect(staged).rejects.toThrow(
            (
              {
                "copy-failed": "Command failed",
                enospc: "ENOSPC",
                "wrong-config": "changed validated Base",
                "bad-json": "JSON",
                "peak-blocked": "peak disk",
              } as Record<string, string>
            )[mode],
          );
        expect(
          readdirSync(root).filter((name) => name.startsWith("base-transfer-")),
        ).toEqual([]);
        const commands = readFileSync(trace, "utf8");
        expect(commands).not.toContain("docker://");
        if (mode === "peak-blocked") expect(commands).toBe("");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
    it("does not allow a standalone staging command on this application host", () => {
      const result = spawnSync(
        process.execPath,
        [
          resolve("deploy/scripts/ghcr-base-publication.mjs"),
          "stage",
          "unused",
          "unused",
        ],
        {
          encoding: "utf8",
          env: { ...process.env, GITHUB_ACTIONS: "", RUNNER_ENVIRONMENT: "" },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("disposable hosted runner");
    });
  },
);

it("separates native validation, immutable publication, anonymous pulls and latest promotion", () => {
  const daily = readFileSync(
    ".github/workflows/renderer-image-daily.yml",
    "utf8",
  );
  expect(daily).toContain(
    "architecture: ${{ fromJSON(needs.validate-source.outputs.architectures) }}",
  );
  expect(daily).toContain("needs: [validate-source, build-and-publish]");
  expect(daily).toContain(
    "needs: [validate-source, publish-index, verify-public]",
  );
  expect(daily).toContain("architecture: [amd64, arm64]");
  expect(daily).toContain("ubuntu-24.04-arm");
  expect(daily).toContain("outputs.mode != 'legacy'");
  expect(daily).toContain("retention-days: 1");
  expect(daily).toContain(
    "if: always() && needs.validate-source.result == 'success'",
  );
  expect(daily).toMatch(
    /needs:\s*\[\s*validate-source,\s*build-and-publish,\s*publish-index,\s*verify-public,\s*promote-latest,?\s*\]/,
  );
  expect(daily).not.toMatch(/setup-qemu|cache-to:|cache-from:/);
  expect(daily.indexOf("ci-validate-texlive-base.sh")).toBeLessThan(
    daily.indexOf("ghcr-base-publication.mjs stage"),
  );
  for (const name of ["server-release", "server-update-validation"]) {
    const workflow = readFileSync(`.github/workflows/${name}.yml`, "utf8");
    expect(workflow).toContain("baseline: [legacy, installed]");
    expect(workflow).toContain("baseline: native-arm64");
    expect(workflow).toContain("architecture: arm64");
    expect(workflow).toContain("ubuntu-24.04-arm");
  }
  const host = readFileSync("deploy/ci/update-e2e.mjs", "utf8");
  expect(host).toContain('from "./update-baseline.mjs"');
  const baseline = readFileSync("deploy/ci/update-baseline.mjs", "utf8");
  expect(baseline).toContain('"native-arm64": `v${[1, 5, 0].join(".")}-rc.1`');
  expect(baseline).toContain(
    "Update baseline does not match the native host architecture",
  );
  const provision = readFileSync("deploy/ci/provision-update-host.mjs", "utf8");
  expect(
    provision.indexOf("const baseDigest = await nativeBaseDigest"),
  ).toBeLessThan(provision.indexOf('run("/bin/sh"'));
  expect(provision).toContain(
    'selector: { mode: "digest", value: baseDigest }',
  );
});
