import { describe, expect, it, vi } from "vitest";
import { runGhcrRetention } from "../deploy/scripts/ghcr-retention.mjs";

const digest = (id: number) => `sha256:${id.toString(16).padStart(64, "0")}`;
const manifest = {
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.manifest.v1+json",
};
function version(id: number, tags: string[], updated = "2026-08-01T00:00:00Z") {
  return {
    id,
    name: digest(id),
    metadata: { container: { tags } },
    updated_at: updated,
    created_at: updated,
  };
}
type Version = ReturnType<typeof version>;
function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}
function fixture(
  options: {
    mode?:
      "removed" | "404-present" | "404-absent" | "204-present" | "403" | "lag";
    list?: Version[];
    permission?: number;
    promote?: boolean;
    onRead?: (list: Version[], count: number) => void;
  } = {},
) {
  const list = structuredClone(
    options.list ?? [
      version(1, ["latest", "2026-09-29"]),
      version(2, ["2026-08-26"]),
      version(5, ["2026-08-30"]),
    ],
  );
  let reads = 0,
    lagId: number | undefined,
    lagReads = 0;
  const fetchImpl = vi.fn<typeof fetch>((input, init) => {
    const url = requestUrl(input);
    if (url.includes("state=deleted"))
      return Promise.resolve(
        new Response("[]", { status: options.permission ?? 200 }),
      );
    if (init?.method === "DELETE") {
      const id = Number(url.split("/").at(-1));
      const status = options.mode?.startsWith("404")
        ? 404
        : options.mode === "403"
          ? 403
          : 204;
      if (
        !options.mode ||
        options.mode === "removed" ||
        options.mode === "404-absent"
      )
        list.splice(
          list.findIndex((v) => v.id === id),
          1,
        );
      if (options.mode === "lag") lagId = id;
      return Promise.resolve(new Response(null, { status }));
    }
    reads += 1;
    options.onRead?.(list, reads);
    if (lagId !== undefined && ++lagReads === 3)
      list.splice(
        list.findIndex((v) => v.id === lagId),
        1,
      );
    return Promise.resolve(new Response(JSON.stringify(list)));
  });
  const spawnImpl = vi.fn((_command: string, args: string[]) => {
    const weekly = args[5]?.split(":").at(-1),
      source = args[6]?.split(":").at(-1);
    if (options.promote !== false && weekly && source) {
      for (const v of list)
        v.metadata.container.tags = v.metadata.container.tags.filter(
          (t) => t !== weekly,
        );
      list
        .find((v) => v.metadata.container.tags.includes(source))
        ?.metadata.container.tags.push(weekly);
    }
    return { status: 0 };
  });
  const readManifestImpl = vi
    .fn<(digest: string) => Promise<unknown>>()
    .mockResolvedValue(manifest);
  const log = vi.fn<(record: Record<string, unknown>) => void>();
  const sleep = vi
    .fn<(ms: number) => Promise<unknown>>()
    .mockResolvedValue(undefined);
  const config = {
    env: { GITHUB_TOKEN: "fixture-not-a-secret" },
    now: new Date("2026-09-30T12:00:00Z"),
    fetchImpl,
    spawnImpl,
    readManifestImpl,
    sleep,
    log,
  };
  return { list, fetchImpl, spawnImpl, readManifestImpl, sleep, log, config };
}
const deleteCalls = (f: ReturnType<typeof fixture>) =>
  f.fetchImpl.mock.calls.filter(([, init]) => init?.method === "DELETE");
const transportError = (code = "ECONNRESET") =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("fixture-not-a-secret"), { code }),
  });

describe("verified GHCR retention", () => {
  it.each([
    "ECONNRESET",
    "ETIMEDOUT",
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
  ])(
    "retries transient GET %s without leaking transport details",
    async (code) => {
      const f = fixture();
      f.fetchImpl.mockRejectedValueOnce(transportError(code));
      expect(await runGhcrRetention(f.config)).toMatchObject({
        deletedVersions: 1,
      });
      expect(f.sleep).toHaveBeenCalledExactlyOnceWith(1000);
      expect(f.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "retention_api_retry",
          method: "GET",
          reason: code,
        }),
      );
      expect(JSON.stringify(f.log.mock.calls)).not.toContain(
        "fixture-not-a-secret",
      );
      expect(deleteCalls(f)).toHaveLength(1);
    },
  );

  it("bounds persistent read failures to three requests without mutations", async () => {
    const f = fixture();
    f.fetchImpl.mockRejectedValue(transportError());
    await expect(runGhcrRetention(f.config)).rejects.toThrow("attempt 3/3");
    expect(f.fetchImpl).toHaveBeenCalledTimes(3);
    expect(f.sleep.mock.calls).toEqual([[1000], [2000]]);
    expect(f.spawnImpl).not.toHaveBeenCalled();
    expect(deleteCalls(f)).toHaveLength(0);
  });

  it("retries the entire GET after a truncated response body", async () => {
    const f = fixture();
    f.fetchImpl.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(transportError("UND_ERR_SOCKET"));
          },
        }),
      ),
    );
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 1,
    });
    expect(f.sleep).toHaveBeenCalledTimes(1);
  });

  it.each([408, 500, 502, 503, 504])(
    "retries temporary metadata HTTP %s only on GET",
    async (status) => {
      const f = fixture();
      f.fetchImpl.mockResolvedValueOnce(new Response("temporary", { status }));
      expect(await runGhcrRetention(f.config)).toMatchObject({
        deletedVersions: 1,
      });
      expect(f.sleep).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403, 404])(
    "does not retry metadata authorization/identity HTTP %s",
    async (status) => {
      const f = fixture();
      f.fetchImpl.mockResolvedValueOnce(new Response(null, { status }));
      await expect(runGhcrRetention(f.config)).rejects.toThrow(
        `HTTP ${status}`,
      );
      expect(f.fetchImpl).toHaveBeenCalledTimes(1);
      expect(f.sleep).not.toHaveBeenCalled();
      expect(deleteCalls(f)).toHaveLength(0);
    },
  );

  it("honors a short Retry-After but defers long or missing rate-limit waits", async () => {
    const f = fixture();
    f.fetchImpl.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "retry-after": "2" } }),
    );
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 1,
    });
    expect(f.sleep).toHaveBeenCalledExactlyOnceWith(2000);
    const longHints: HeadersInit[] = [
      {},
      { "retry-after": "60" },
      { "retry-after": "bad" },
    ];
    for (const headers of longHints) {
      const g = fixture();
      g.fetchImpl.mockResolvedValueOnce(
        new Response(null, { status: 429, headers }),
      );
      await expect(runGhcrRetention(g.config)).rejects.toThrow("deferred");
      expect(g.fetchImpl).toHaveBeenCalledTimes(1);
      expect(g.sleep).not.toHaveBeenCalled();
      expect(deleteCalls(g)).toHaveLength(0);
    }
  });

  it("does not retry TLS verification failures or corrupt JSON", async () => {
    const f = fixture();
    f.fetchImpl.mockRejectedValueOnce(transportError("CERT_HAS_EXPIRED"));
    await expect(runGhcrRetention(f.config)).rejects.toThrow("fetch failed");
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.sleep).not.toHaveBeenCalled();
    const g = fixture();
    g.fetchImpl.mockResolvedValueOnce(new Response("broken JSON"));
    await expect(runGhcrRetention(g.config)).rejects.toThrow();
    expect(g.fetchImpl).toHaveBeenCalledTimes(1);
    expect(deleteCalls(g)).toHaveLength(0);
  });

  it("rejects oversized metadata before parsing or mutation", async () => {
    const f = fixture();
    f.fetchImpl.mockResolvedValueOnce(
      new Response("[]", {
        headers: { "content-length": String(9 * 1024 ** 2) },
      }),
    );
    await expect(runGhcrRetention(f.config)).rejects.toThrow("8 MiB");
    expect(deleteCalls(f)).toHaveLength(0);
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it("rechecks the whole inventory after a retry before DELETE", async () => {
    const f = fixture({
      onRead: (list, count) => {
        if (count === 3) list.push(version(9, ["new-index"]));
      },
    });
    const original = f.fetchImpl.getMockImplementation();
    if (!original) throw new Error("Missing fixture transport");
    let reads = 0;
    f.fetchImpl.mockImplementation((input, init) => {
      if (requestUrl(input).includes("state=active") && ++reads === 3)
        return Promise.reject(transportError());
      return original(input, init);
    });
    await expect(runGhcrRetention(f.config)).rejects.toThrow(
      "inventory changed",
    );
    expect(f.sleep).toHaveBeenCalledTimes(1);
    expect(deleteCalls(f)).toHaveLength(0);
  });

  it("observes absence after a lost DELETE reply, without resending or claiming confirmed deletion", async () => {
    const f = fixture();
    const original = f.fetchImpl.getMockImplementation();
    if (!original) throw new Error("Missing fixture transport");
    f.fetchImpl.mockImplementation(async (input, init) => {
      const response = await original(input, init);
      if (init?.method === "DELETE") throw transportError();
      return response;
    });
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 0,
      alreadyAbsentVersions: 1,
    });
    expect(deleteCalls(f)).toHaveLength(1);
    expect(f.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "delete_verified",
        responseConfirmed: false,
        result: "already-absent",
      }),
    );
  });

  it("stops if a lost DELETE reply leaves the candidate present", async () => {
    const f = fixture({ mode: "204-present" });
    const original = f.fetchImpl.getMockImplementation();
    if (!original) throw new Error("Missing fixture transport");
    f.fetchImpl.mockImplementation(async (input, init) => {
      const response = await original(input, init);
      if (init?.method === "DELETE") throw transportError();
      return response;
    });
    await expect(runGhcrRetention(f.config)).rejects.toThrow(
      "deletion NOT confirmed",
    );
    expect(deleteCalls(f)).toHaveLength(1);
    expect(
      f.log.mock.calls.some(([r]) => r.event === "retention_complete"),
    ).toBe(false);
  });

  it("does not infer deletion from unreadable inventory after DELETE", async () => {
    const f = fixture();
    const original = f.fetchImpl.getMockImplementation();
    if (!original) throw new Error("Missing fixture transport");
    let deleted = false;
    f.fetchImpl.mockImplementation(async (input, init) => {
      if (deleted) throw transportError();
      const response = await original(input, init);
      if (init?.method === "DELETE") deleted = true;
      return response;
    });
    await expect(runGhcrRetention(f.config)).rejects.toThrow("attempt 3/3");
    expect(deleteCalls(f)).toHaveLength(1);
    expect(
      f.log.mock.calls.some(([r]) => r.event === "retention_complete"),
    ).toBe(false);
  });

  it("never retries DELETE on a temporary HTTP failure", async () => {
    const f = fixture();
    const original = f.fetchImpl.getMockImplementation();
    if (!original) throw new Error("Missing fixture transport");
    f.fetchImpl.mockImplementation((input, init) =>
      init?.method === "DELETE"
        ? Promise.resolve(new Response(null, { status: 503 }))
        : original(input, init),
    );
    await expect(runGhcrRetention(f.config)).rejects.toThrow("HTTP 503");
    expect(deleteCalls(f)).toHaveLength(1);
    expect(f.sleep).not.toHaveBeenCalled();
  });

  it("counts only DELETE 204 followed by absence in a readable active inventory", async () => {
    const f = fixture();
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 1,
      alreadyAbsentVersions: 0,
    });
    expect(f.list.map((v) => v.id)).toEqual([1, 5]);
    expect(f.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "delete_response",
        versionId: 2,
        status: 204,
      }),
    );
    expect(f.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: "delete_verified", versionId: 2 }),
    );
  });
  it.each(["404-present", "204-present"] as const)(
    "rejects %s when the version is still active",
    async (mode) => {
      const f = fixture({ mode });
      await expect(runGhcrRetention(f.config)).rejects.toThrow(
        "deletion NOT confirmed",
      );
      expect(f.sleep).toHaveBeenCalledTimes(2);
      expect(
        f.log.mock.calls.some(([r]) => r.event === "retention_complete"),
      ).toBe(false);
    },
  );
  it("does not count an already-absent 404 as a deletion", async () => {
    const f = fixture({ mode: "404-absent" });
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 0,
      alreadyAbsentVersions: 1,
    });
  });
  it("allows bounded eventual consistency after 204", async () => {
    const f = fixture({ mode: "lag" });
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 1,
    });
    expect(f.sleep).toHaveBeenCalledTimes(2);
  });
  it("fails on deletion denial without logging credentials", async () => {
    const f = fixture({ mode: "403" });
    await expect(runGhcrRetention(f.config)).rejects.toThrow("HTTP 403");
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(
      "fixture-not-a-secret",
    );
  });
  it.each([403, 404])(
    "fails Admin preflight %s before any mutation",
    async (permission) => {
      const f = fixture({ permission });
      await expect(runGhcrRetention(f.config)).rejects.toThrow(
        "Manage Actions access",
      );
      expect(deleteCalls(f)).toHaveLength(0);
      expect(f.spawnImpl).not.toHaveBeenCalled();
    },
  );
  it("verifies weekly promotion before deleting the previous source", async () => {
    const f = fixture({
      list: [
        version(1, ["latest", "2026-09-29"]),
        version(2, ["2026-09-14", "weekly-2026-W38"]),
        version(5, ["2026-09-15"]),
      ],
    });
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 1,
    });
    expect(f.list.find((v) => v.id === 5)?.metadata.container.tags).toContain(
      "weekly-2026-W38",
    );
    expect(f.list.find((v) => v.id === 2)).toBeUndefined();
  });
  it("stops on docker success without actual weekly tag movement", async () => {
    const f = fixture({ promote: false });
    await expect(runGhcrRetention(f.config)).rejects.toThrow(
      "does not reference verified source",
    );
    expect(deleteCalls(f)).toHaveLength(0);
  });
  it("stops when a deletion candidate gains a protected tag", async () => {
    const f = fixture({
      onRead: (list, count) => {
        if (count === 3)
          list.find((v) => v.id === 2)?.metadata.container.tags.push("saved");
      },
    });
    await expect(runGhcrRetention(f.config)).rejects.toThrow(
      "changed since planning",
    );
    expect(deleteCalls(f)).toHaveLength(0);
  });
  it("replans if a new retained index appears after reference checks", async () => {
    const f = fixture({
      onRead: (list, count) => {
        if (count === 3) list.push(version(9, ["new-retained-index"]));
      },
    });
    await expect(runGhcrRetention(f.config)).rejects.toThrow(
      "inventory changed since reference checks",
    );
    expect(deleteCalls(f)).toHaveLength(0);
  });
  it("removes unsupported legacy Runtime by default, protecting mixed tags", async () => {
    const tag = `runtime-v1-2026-09-05-${"a".repeat(32)}`;
    const f = fixture({
      list: [
        version(1, ["latest"]),
        version(3, [tag]),
        version(4, [tag, "saved"]),
      ],
    });
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedLegacyRuntimeVersions: 1,
    });
    expect(f.list.map((v) => v.id)).toEqual([1, 4]);
  });
  it("supports a diagnostic legacy preservation override", async () => {
    const f = fixture({
      list: [version(3, [`runtime-v1-2026-09-05-${"a".repeat(32)}`])],
    });
    expect(
      await runGhcrRetention({
        ...f.config,
        env: { ...f.config.env, GHCR_PURGE_LEGACY_RUNTIMES: "false" },
      }),
    ).toMatchObject({ deletedVersions: 0 });
  });
  it("prioritizes unsupported Runtime cleanup before dated Base", async () => {
    const f = fixture({
      list: [
        version(1, ["latest"]),
        version(2, ["2026-08-26"]),
        version(5, ["2026-08-30"]),
        version(3, [`runtime-v1-2026-09-05-${"a".repeat(32)}`]),
      ],
    });
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 2,
    });
    expect(
      deleteCalls(f).map(([input]) =>
        (typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url
        )
          .split("/")
          .at(-1),
      ),
    ).toEqual(["3", "2"]);
  });
  it("protects latest, recent dates, unknown tags and newly requested old dates", async () => {
    const f = fixture({
      list: [
        version(1, ["latest", "2026-08-01"]),
        version(2, ["2026-09-16"]),
        version(3, ["saved"]),
        version(4, ["2026-05-01"], "2026-09-29T00:00:00Z"),
      ],
    });
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 0,
    });
  });
  it("deletes expired untagged manifests after checking references", async () => {
    const f = fixture({ list: [version(1, ["latest"]), version(4, [])] });
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedUntaggedVersions: 1,
    });
    expect(f.readManifestImpl).toHaveBeenCalledTimes(2);
  });
  it("preserves untagged index children transitively", async () => {
    const f = fixture({
      list: [version(1, ["latest"]), version(4, []), version(6, [])],
    });
    f.readManifestImpl.mockImplementation((d) =>
      Promise.resolve(
        d === digest(6)
          ? manifest
          : {
              schemaVersion: 2,
              mediaType: "application/vnd.oci.image.index.v1+json",
              manifests: [{ digest: digest(d === digest(1) ? 4 : 6) }],
            },
      ),
    );
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 0,
    });
  });
  it("retains both native Base children but collects expired uploads from an abandoned run", async () => {
    const f = fixture({
      list: [
        version(1, ["latest", "2026-09-29"]),
        version(4, []),
        version(6, []),
        version(8, []),
      ],
    });
    f.readManifestImpl.mockImplementation((d) =>
      Promise.resolve(
        d === digest(1)
          ? {
              schemaVersion: 2,
              mediaType: "application/vnd.oci.image.index.v1+json",
              manifests: [
                {
                  digest: digest(4),
                  platform: { os: "linux", architecture: "amd64" },
                },
                {
                  digest: digest(6),
                  platform: { os: "linux", architecture: "arm64" },
                },
              ],
            }
          : manifest,
      ),
    );
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 1,
      deletedUntaggedVersions: 1,
    });
    expect(deleteCalls(f)).toHaveLength(1);
    expect(deleteCalls(f)[0]?.[0]).toBe(
      "https://api.github.com/users/n624-dev/packages/container/latex-renderer-texlive/versions/8",
    );
  });
  it("preserves untagged attestation subjects", async () => {
    const f = fixture({ list: [version(1, ["latest"]), version(4, [])] });
    f.readManifestImpl.mockImplementation((d) =>
      Promise.resolve(
        d === digest(1)
          ? { ...manifest, subject: { digest: digest(4) } }
          : manifest,
      ),
    );
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 0,
    });
  });
  it("preserves a tagged old Base referenced by a retained index", async () => {
    const f = fixture();
    f.readManifestImpl.mockImplementation((d) =>
      Promise.resolve(
        d === digest(1)
          ? {
              schemaVersion: 2,
              mediaType: "application/vnd.oci.image.index.v1+json",
              manifests: [{ digest: digest(2) }],
            }
          : manifest,
      ),
    );
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 0,
    });
  });
  it("stops on invalid manifest data before any DELETE", async () => {
    const f = fixture();
    f.readManifestImpl.mockResolvedValue({ schemaVersion: 99 });
    await expect(runGhcrRetention(f.config)).rejects.toThrow(
      "Invalid/unsupported",
    );
    expect(deleteCalls(f)).toHaveLength(0);
  });
  it("stops on an unreadable active list after DELETE instead of inferring absence", async () => {
    const f = fixture();
    let deleted = false;
    const originalFetch = f.fetchImpl.getMockImplementation();
    if (!originalFetch) throw new Error("Missing fixture transport");
    f.fetchImpl.mockImplementation((input, init) => {
      if (init?.method === "DELETE") deleted = true;
      else if (deleted)
        return Promise.resolve(new Response(null, { status: 403 }));
      return originalFetch(input, init);
    });
    await expect(runGhcrRetention(f.config)).rejects.toThrow(
      "version list failed: HTTP 403",
    );
    expect(
      f.log.mock.calls.some(([r]) => r.event === "retention_complete"),
    ).toBe(false);
  });
  it("preserves malformed weekly names as unknown tags", async () => {
    const f = fixture({
      list: [version(1, ["latest"]), version(2, ["weekly-2026-W00"])],
    });
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 0,
    });
  });
  it("stops on missing referenced manifests before DELETE", async () => {
    const f = fixture({ list: [version(1, ["latest"]), version(4, [])] });
    f.readManifestImpl.mockResolvedValue({
      ...manifest,
      subject: { digest: digest(99) },
    });
    await expect(runGhcrRetention(f.config)).rejects.toThrow(
      "missing from inventory",
    );
    expect(deleteCalls(f)).toHaveLength(0);
  });
  it("preserves recent untagged and unreadable ages", async () => {
    const f = fixture({
      list: [
        version(4, [], "2026-09-29T00:00:00Z"),
        version(6, [], "invalid"),
        version(7, ["2026-05-01"], "invalid"),
      ],
    });
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 0,
    });
  });
  it("dry-run plans without writes or Admin permission", async () => {
    const f = fixture({ permission: 403 });
    expect(
      await runGhcrRetention({
        ...f.config,
        env: { ...f.config.env, GHCR_DRY_RUN: "true" },
      }),
    ).toMatchObject({ dryRun: true, plannedVersions: 1, deletedVersions: 0 });
    expect(f.spawnImpl).not.toHaveBeenCalled();
    expect(deleteCalls(f)).toHaveLength(0);
    expect(f.list).toHaveLength(3);
  });
  it("repeat cleanup does not count already-deleted versions", async () => {
    const f = fixture();
    await runGhcrRetention(f.config);
    expect(await runGhcrRetention(f.config)).toMatchObject({
      deletedVersions: 0,
    });
  });
  it.each([
    { GHCR_DRY_RUN: "yes" },
    { GHCR_OWNER: "../bad" },
    { GHCR_REPOSITORY: "ghcr.io/other/image" },
    { GHCR_OWNER_TYPE: "other" },
    { GHCR_REQUEST_TIMEOUT_SECONDS: "0" },
  ])("rejects invalid configuration %j before requests", async (env) => {
    const f = fixture();
    await expect(
      runGhcrRetention({ ...f.config, env: { ...f.config.env, ...env } }),
    ).rejects.toThrow();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});
