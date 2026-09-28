import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clientRendererBaseUrl, PUBLIC_ORIGIN } from "@latex-renderer/shared";

const roots: string[] = [];
const names = ["latex-render", "latex-renderer-mcp"] as const;
const cases = [
  { label: "none", values: {}, expected: PUBLIC_ORIGIN },
  {
    label: "base",
    values: { LATEX_RENDER_BASE_URL: "https://base.test" },
    expected: "https://base.test",
  },
  {
    label: "renderer",
    values: { LATEX_RENDER_RENDERER_URL: "https://renderer.test" },
    expected: "https://renderer.test",
  },
  {
    label: "gateway",
    values: { LATEX_RENDER_GATEWAY_URL: "https://gateway.test" },
    expected: "https://gateway.test",
  },
  {
    label: "renderer and gateway",
    values: {
      LATEX_RENDER_RENDERER_URL: "https://renderer.test",
      LATEX_RENDER_GATEWAY_URL: "https://gateway.test",
    },
    expected: "https://renderer.test",
  },
  {
    label: "all",
    values: {
      LATEX_RENDER_BASE_URL: "https://base.test",
      LATEX_RENDER_RENDERER_URL: "https://renderer.test",
      LATEX_RENDER_GATEWAY_URL: "https://gateway.test",
    },
    expected: "https://base.test",
  },
] as const;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bundled client launchers", () => {
  it.each(cases)(
    "resolves $label with the shared direct-client fallback",
    ({ values, expected }) => {
      expect(clientRendererBaseUrl(values)).toBe(expected);
    },
  );
  it.runIf(process.platform !== "win32")(
    "passes endpoint variables through on Unix without hiding legacy fallbacks",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "client-launcher-endpoint-"));
      roots.push(root);
      const bin = join(root, "bin");
      const app = join(root, "app");
      await mkdir(bin);
      await mkdir(app);
      for (const name of names) {
        await writeFile(
          join(bin, name),
          await readFile(join(process.cwd(), "client", "unix", name)),
          { mode: 0o755 },
        );
        await writeFile(
          join(app, `${name}.cjs`),
          "console.log(JSON.stringify({base:process.env.LATEX_RENDER_BASE_URL??null,renderer:process.env.LATEX_RENDER_RENDERER_URL??null,gateway:process.env.LATEX_RENDER_GATEWAY_URL??null}));",
        );
      }
      for (const name of names)
        for (const testCase of cases) {
          const values: Readonly<Record<string, string | undefined>> =
            testCase.values;
          const env = { ...process.env };
          delete env.LATEX_RENDER_BASE_URL;
          delete env.LATEX_RENDER_RENDERER_URL;
          delete env.LATEX_RENDER_GATEWAY_URL;
          Object.assign(env, values);
          const result = spawnSync(join(bin, name), [], {
            encoding: "utf8",
            env,
            timeout: 15_000,
          });
          expect(
            result.status,
            `${name}: ${testCase.label}: ${result.stderr}`,
          ).toBe(0);
          expect(JSON.parse(result.stdout)).toEqual({
            base: values.LATEX_RENDER_BASE_URL ?? null,
            renderer: values.LATEX_RENDER_RENDERER_URL ?? null,
            gateway: values.LATEX_RENDER_GATEWAY_URL ?? null,
          });
        }
    },
  );

  it.runIf(process.platform === "win32")(
    "passes endpoint variables through on Windows without hiding legacy fallbacks",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "client-launcher-endpoint-"));
      roots.push(root);
      const bin = join(root, "bin");
      const app = join(root, "app");
      await mkdir(bin);
      await mkdir(app);
      for (const name of names) {
        await writeFile(
          join(bin, `${name}.cmd`),
          await readFile(
            join(process.cwd(), "client", "windows", `${name}.cmd`),
          ),
        );
        await writeFile(
          join(app, `${name}.cjs`),
          "console.log(JSON.stringify({base:process.env.LATEX_RENDER_BASE_URL??null,renderer:process.env.LATEX_RENDER_RENDERER_URL??null,gateway:process.env.LATEX_RENDER_GATEWAY_URL??null}));",
        );
      }
      for (const name of names)
        for (const testCase of cases) {
          const values: Readonly<Record<string, string | undefined>> =
            testCase.values;
          const env = { ...process.env };
          delete env.LATEX_RENDER_BASE_URL;
          delete env.LATEX_RENDER_RENDERER_URL;
          delete env.LATEX_RENDER_GATEWAY_URL;
          Object.assign(env, values);
          const command = join(bin, `${name}.cmd`);
          const result = spawnSync(
            "cmd.exe",
            ["/d", "/s", "/c", `""${command}""`],
            {
              encoding: "utf8",
              env,
              windowsVerbatimArguments: true,
              timeout: 15_000,
            },
          );
          expect(
            result.status,
            `${name}: ${testCase.label}: ${result.stderr}`,
          ).toBe(0);
          expect(JSON.parse(result.stdout)).toEqual({
            base: values.LATEX_RENDER_BASE_URL ?? null,
            renderer: values.LATEX_RENDER_RENDERER_URL ?? null,
            gateway: values.LATEX_RENDER_GATEWAY_URL ?? null,
          });
        }
    },
  );
});
