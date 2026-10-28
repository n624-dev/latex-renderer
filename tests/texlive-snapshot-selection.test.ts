import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const host = "texlive-ci.example.invalid",
  origin = `https://${host}`,
  archive = "https://archive.example.invalid";
const snapshotId = `tl2026-${"c".repeat(16)}-${"d".repeat(16)}-${"e".repeat(16)}-v3`;
const pointer = {
  schemaVersion: 1,
  snapshotId,
  url: `${origin}/snapshots/${snapshotId}/tlnet`,
  publishedAt: "2026-09-08T01:00:00.000Z",
  canonicalDate: "2026-09-08",
  installerSha512: "d".repeat(128),
  databaseSha512: "c".repeat(128),
};
const repository = `${archive}/2026/09/08/tlnet`;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "texlive-selection-"));
  roots.push(root);
  const bin = join(root, "bin"),
    trace = join(root, "trace"),
    output = join(root, "output"),
    responses = join(root, "responses.json"),
    preload = join(root, "date.mjs");
  await mkdir(bin);
  await writeFile(
    join(bin, "curl"),
    `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2),url=args.at(-1);
fs.appendFileSync(process.env.FIXTURE_TRACE,JSON.stringify({args,url})+'\\n');
let value=JSON.parse(fs.readFileSync(process.env.FIXTURE_RESPONSES,'utf8'))[url];
if(value===undefined)process.exit(99);
if(Array.isArray(value)) {
  const n=fs.readFileSync(process.env.FIXTURE_TRACE,'utf8').trim().split('\\n').map(JSON.parse).filter(x=>x.url===url).length;
  value=value[Math.min(n-1,value.length-1)];
}
const response=value && typeof value==='object' && 'curlExit' in value ? value : null;
const code=typeof value==='number'?value:response?.curlExit??0;
const body=response?.body??(typeof value==='number'?'':typeof value==='string'?value:JSON.stringify(value));
process.stdout.write(body+'\\n__TEXLIVE_CURL_METRICS__'+JSON.stringify({http_code:response?.httpStatus??(code?0:200),time_namelookup:0.01,time_connect:2.3,time_appconnect:23.8,time_starttransfer:24,time_total:24,url_effective:url,errormsg:'private-sentinel'}));
process.exit(code);
`,
    { mode: 0o700 },
  );
  await writeFile(
    preload,
    `const ActualDate=Date;globalThis.Date=class extends ActualDate {constructor(...args){if(args.length===0)super('2026-09-09T00:00:00.000Z');else super(...args);}static now(){return ActualDate.parse('2026-09-09T00:00:00.000Z');}};\nif(process.env.FIXTURE_CLOCK){const steps=JSON.parse(process.env.FIXTURE_CLOCK);let i=0;Object.defineProperty(performance,'now',{value:()=>steps[Math.min(i++,steps.length-1)]});}\n`,
  );
  await writeFile(output, "unrelated=preserve\n");
  const defaults: Record<string, unknown> = {
    [`${origin}/latest.json`]: pointer,
    [`${repository}/install-tl-unx.tar.gz.sha512`]: `${pointer.installerSha512}  install-tl-unx.tar.gz\n`,
    [`${repository}/tlpkg/texlive.tlpdb.sha512`]: `${pointer.databaseSha512}  texlive.tlpdb\n`,
  };
  const run = async (
    overrides: Record<string, unknown> = {},
    requested = "latest",
    env: Record<string, string> = {},
  ) => {
    await writeFile(responses, JSON.stringify({ ...defaults, ...overrides }));
    const result = spawnSync(
      "sh",
      ["deploy/scripts/resolve-texlive-snapshot.sh", requested],
      {
        encoding: "utf8",
        timeout: 20000,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`,
          FIXTURE_TRACE: trace,
          FIXTURE_RESPONSES: responses,
          TEXLIVE_CI_MIRROR_HOST: host,
          TEXLIVE_ARCHIVE_ROOT: archive,
          GITHUB_OUTPUT: output,
          TEXLIVE_CURL_CONNECT_TIMEOUT_SECONDS: "30",
          TEXLIVE_CURL_MAX_TIME_SECONDS: "60",
          ...env,
        },
      },
    );
    const calls = (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { url: string; args: string[] });
    return { result, calls, output: await readFile(output, "utf8") };
  };
  return { run };
}
describe.skipIf(process.platform === "win32")(
  "mirror-first exact canonical snapshot selection",
  () => {
    it("selects one published date and validates both canonical identities without probing older dates", async () => {
      const f = await fixture(),
        { result, calls, output } = await f.run();
      expect(result.status, result.stderr).toBe(0);
      expect(calls.map((call) => call.url)).toEqual([
        `${origin}/latest.json`,
        `${repository}/install-tl-unx.tar.gz.sha512`,
        `${repository}/tlpkg/texlive.tlpdb.sha512`,
      ]);
      expect(result.stderr).not.toContain("private-sentinel");
      expect(result.stderr).not.toContain(host);
      expect(result.stderr).toContain('"time_appconnect":23.8');
      expect(output).toContain(`snapshot_id=${snapshotId}\n`);
      expect(output).toContain(`date=2026-09-08\n`);
      expect(output).toContain(`database_sha512=${pointer.databaseSha512}\n`);
      expect(output).toContain(`repository=${repository}\n`);
      for (const { args } of calls) {
        expect(args[0]).toBe("--disable");
        expect(args[args.indexOf("--connect-timeout") + 1]).toBe("30");
        expect(args).not.toContain("--retry");
        expect(args).toContain("--max-filesize");
        expect(args).toContain("65536");
        expect(args).not.toContain("--location");
      }
    });
    it.each([
      "installer",
      "database",
      "transport",
      "json",
      "schema",
      "url",
      "identity",
      "old",
      "future",
      "year",
    ])(
      "fails closed on %s without selecting another date or appending outputs",
      async (kind) => {
        const f = await fixture();
        let overrides: Record<string, unknown>;
        if (kind === "installer")
          overrides = {
            [`${repository}/install-tl-unx.tar.gz.sha512`]: `${"a".repeat(128)}  install-tl-unx.tar.gz\n`,
          };
        else if (kind === "database")
          overrides = {
            [`${repository}/tlpkg/texlive.tlpdb.sha512`]: `${"a".repeat(128)}  texlive.tlpdb\n`,
          };
        else if (kind === "transport")
          overrides = { [`${repository}/install-tl-unx.tar.gz.sha512`]: 28 };
        else {
          const value =
            kind === "json"
              ? "not JSON private-sentinel"
              : kind === "schema"
                ? { snapshotId }
                : kind === "url"
                  ? { ...pointer, url: "https://other.invalid/payload" }
                  : kind === "identity"
                    ? { ...pointer, databaseSha512: "a".repeat(128) }
                    : kind === "old"
                      ? { ...pointer, canonicalDate: "2026-08-01" }
                      : kind === "future"
                        ? { ...pointer, canonicalDate: "2026-09-10" }
                        : { ...pointer, canonicalDate: "2027-01-01" };
          overrides = { [`${origin}/latest.json`]: value };
        }
        const { result, calls, output } = await f.run(overrides);
        expect(result.status).not.toBe(0);
        expect(output).toBe("unrelated=preserve\n");
        expect(result.stderr).not.toContain("private-sentinel");
        expect(result.stderr).not.toContain(host);
        expect(
          calls.every(
            (call) =>
              call.url === `${origin}/latest.json` ||
              call.url.startsWith(repository + "/"),
          ),
        ).toBe(true);
      },
    );
    it.each([6, 7, 28, 56, 503, 429])(
      "retries transient %s on the exact URL and discards partial bodies",
      async (failure) => {
        const f = await fixture();
        const url = `${repository}/install-tl-unx.tar.gz.sha512`;
        const { result, calls, output } = await f.run({
          [url]: [
            {
              curlExit: failure > 100 ? 22 : failure,
              httpStatus: failure > 100 ? failure : 0,
              body: "discard-private-sentinel",
            },
            `${pointer.installerSha512}  install-tl-unx.tar.gz\n`,
          ],
        });
        expect(result.status, result.stderr).toBe(0);
        expect(calls.map((call) => call.url)).toEqual([
          `${origin}/latest.json`,
          url,
          url,
          `${repository}/tlpkg/texlive.tlpdb.sha512`,
        ]);
        expect(output).toContain(
          `installer_sha512=${pointer.installerSha512}\n`,
        );
        expect(result.stderr).not.toContain("private-sentinel");
        expect(result.stderr).not.toContain(archive);
        expect(result.stderr).toContain('"attempt":2');
      },
    );
    it.each([60, 63, 401, 403, 404, 302])(
      "does not retry certificate, size, authentication or unavailable response %s",
      async (failure) => {
        const f = await fixture();
        const url = `${repository}/install-tl-unx.tar.gz.sha512`;
        const { result, calls, output } = await f.run({
          [url]: {
            curlExit: failure >= 400 ? 22 : failure === 302 ? 0 : failure,
            httpStatus: failure > 100 ? failure : 0,
          },
        });
        expect(result.status).not.toBe(0);
        expect(calls.map((call) => call.url)).toEqual([
          `${origin}/latest.json`,
          url,
        ]);
        expect(output).toBe("unrelated=preserve\n");
      },
    );
    it("bounds exhausted retries without appending output or selecting another date", async () => {
      const f = await fixture();
      const url = `${repository}/tlpkg/texlive.tlpdb.sha512`;
      const { result, calls, output } = await f.run({ [url]: 28 });
      expect(result.status).not.toBe(0);
      expect(calls.filter((call) => call.url === url)).toHaveLength(4);
      expect(new Set(calls.map((call) => call.url))).toEqual(
        new Set([
          `${origin}/latest.json`,
          `${repository}/install-tl-unx.tar.gz.sha512`,
          url,
        ]),
      );
      expect(output).toBe("unrelated=preserve\n");
      expect(result.stderr).toContain("curl 28");
    });
    it("caps the final attempt and stops at the per-URL deadline", async () => {
      const f = await fixture();
      const url = `${repository}/install-tl-unx.tar.gz.sha512`;
      const { result, calls, output } = await f.run(
        { [url]: 28 },
        "2026-09-08",
        { FIXTURE_CLOCK: "[0,170000,180001]" },
      );
      expect(result.status).not.toBe(0);
      expect(calls).toHaveLength(1);
      const first = calls[0];
      if (!first) throw new Error("Expected one bounded request");
      const args = first.args;
      expect(args[args.indexOf("--max-time") + 1]).toBe("10");
      expect(args[args.indexOf("--connect-timeout") + 1]).toBe("10");
      expect(output).toBe("unrelated=preserve\n");
    });
    it("honors an explicit connection timeout", async () => {
      const f = await fixture();
      const { result, calls } = await f.run({}, "2026-09-08", {
        TEXLIVE_CURL_CONNECT_TIMEOUT_SECONDS: "15",
      });
      expect(result.status, result.stderr).toBe(0);
      for (const { args } of calls)
        expect(args[args.indexOf("--connect-timeout") + 1]).toBe("15");
    });
    it("keeps an explicit date explicit and verifies the database as well as installer", async () => {
      const f = await fixture(),
        { result, calls, output } = await f.run({}, "2026-09-08");
      expect(result.status, result.stderr).toBe(0);
      expect(calls).toHaveLength(2);
      expect(calls.some((call) => call.url.endsWith("latest.json"))).toBe(
        false,
      );
      expect(output).toContain("snapshot_id=\n");
    });
  },
);
