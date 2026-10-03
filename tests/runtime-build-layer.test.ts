import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const files = [
  "texmf.cnf",
  "latexmkrc",
  "compile.sh",
  "svg-wrapper.tex",
  "export-svg.pl",
  "install-language-packages.sh",
];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "runtime-layer-fixture-"));
  roots.push(root);
  const source = join(root, "source"),
    bin = join(root, "bin"),
    temporary = join(root, "tmp");
  for (const path of [source, bin, temporary]) mkdirSync(path);
  for (const file of files)
    writeFileSync(join(source, file), `fixture ${file}\n`);
  const dockerfile = join(root, "Dockerfile"),
    trace = join(root, "trace"),
    args = join(root, "args");
  writeFileSync(trace, "");
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_TRACE"
case "$1 $2" in
 'image inspect')
   case "$*" in *RepoDigests*) printf '%s\\n' "\${TEST_REPO_DIGEST:-}" ;; *) printf 'sha256:%s\\n' '${"a".repeat(64)}' ;; esac ;;
 'image tag'|'image rm') exit 0 ;;
 'buildx build'|'build '* )
   printf '%s\\n' "$@" > "$TEST_ARGS"
   for argument do context=$argument; done
   cp "$context/Dockerfile" "$TEST_DOCKERFILE"
   exit "\${TEST_BUILD_EXIT:-0}" ;;
 *) exit 98 ;;
esac
`,
    { mode: 0o700 },
  );
  const build = (
    languages = ["collection-langjapanese", "collection-langenglish"],
    extra: Record<string, string> = {},
  ) => {
    const result = spawnSync(
      "sh",
      [
        "deploy/scripts/build-language-runtime.sh",
        "fixture-base",
        "https://snapshot.example.test/2026/10/02/tlnet",
        "fixture-runtime",
        ...languages,
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TMPDIR: temporary,
          RENDERER_RUNTIME_SOURCE: source,
          RUNTIME_BUILDX_BUILDER: "default",
          RUNTIME_NO_CACHE: "true",
          TEST_TRACE: trace,
          TEST_ARGS: args,
          TEST_DOCKERFILE: dockerfile,
          ...extra,
        },
      },
    );
    return {
      result,
      args: result.status === 0 ? readFileSync(args, "utf8") : "",
      dockerfile: result.status === 0 ? readFileSync(dockerfile, "utf8") : "",
    };
  };
  return { root, bin, source, temporary, trace, build };
}

describe.skipIf(process.platform === "win32")(
  "Runtime build layer boundaries",
  () => {
    it("puts only the language installer before the expensive layer, keeping renderer ARG/COPY afterwards", () => {
      const f = fixture(),
        built = f.build();
      expect(built.result.status, built.result.stderr).toBe(0);
      const install = built.dockerfile.indexOf("RUN set -eu;");
      const firstCopy = built.dockerfile.indexOf(
        "COPY runtime/install-language-packages.sh",
      );
      const rendererCopy = built.dockerfile.indexOf(
        "COPY runtime/ /opt/renderer/",
      );
      expect(firstCopy).toBeLessThan(install);
      expect(rendererCopy).toBeGreaterThan(install);
      expect(
        built.dockerfile.indexOf("ARG RENDERER_RUNTIME_FINGERPRINT"),
      ).toBeGreaterThan(install);
      expect(built.args).toContain("--no-cache\n");
      expect(built.args).toContain("--load\n");
      expect(built.args).toContain("TEXLIVE_FORMAT_JOBS=1\n");
      expect(built.args).toContain(
        "TEXLIVE_LANGUAGES=collection-langenglish collection-langjapanese",
      );
      expect(built.dockerfile).toContain(
        'ENTRYPOINT ["/opt/renderer/compile.sh"]',
      );
      expect(readdirSync(f.temporary)).toEqual([]);
      expect(readFileSync(f.trace, "utf8")).toContain(
        "image rm latex-renderer:base-lock-",
      );
    });
    it("renderer changes leave language-layer inputs identical but change the full Runtime identity", () => {
      const f = fixture(),
        before = f.build();
      appendFileSync(join(f.source, "compile.sh"), "renderer changed\n");
      const after = f.build();
      expect(before.result.status).toBe(0);
      expect(after.result.status).toBe(0);
      const layerInputs = (dockerfile: string) =>
        dockerfile.slice(
          0,
          dockerfile.indexOf("ARG RENDERER_RUNTIME_FINGERPRINT"),
        );
      expect(layerInputs(after.dockerfile)).toBe(
        layerInputs(before.dockerfile),
      );
      const identity = (args: string) =>
        args
          .split("\n")
          .find((arg) =>
            arg.startsWith("jp.n624.latex-renderer.runtime-identity="),
          );
      expect(identity(before.args)).toBeDefined();
      expect(identity(after.args)).not.toBe(identity(before.args));
    });
    it("an installer-helper change still changes the Runtime identity", () => {
      const f = fixture(),
        before = f.build();
      appendFileSync(
        join(f.source, "install-language-packages.sh"),
        "installer changed\n",
      );
      const after = f.build();
      expect(after.result.status).toBe(0);
      expect(after.args).not.toBe(before.args);
    });
    it("does not create an immutable Base lock tag for invalid language input", () => {
      const f = fixture(),
        built = f.build(["not-a-language"]);
      expect(built.result.status).toBe(64);
      expect(readFileSync(f.trace, "utf8")).not.toContain("image tag");
      expect(readdirSync(f.temporary)).toEqual([]);
    });
    it.each(["2", "4"])(
      "passes explicit format concurrency %s into the language layer",
      (jobs) => {
        const built = fixture().build(undefined, { RUNTIME_FORMAT_JOBS: jobs });
        expect(built.result.status, built.result.stderr).toBe(0);
        expect(built.args).toContain(`TEXLIVE_FORMAT_JOBS=${jobs}\n`);
      },
    );
    it.each(["0", "3", "8", "2; echo unsafe"])(
      "rejects format concurrency %s before Docker mutations",
      (jobs) => {
        const f = fixture(),
          built = f.build(undefined, { RUNTIME_FORMAT_JOBS: jobs });
        expect(built.result.status).toBe(64);
        expect(readFileSync(f.trace, "utf8")).toBe("");
        expect(readdirSync(f.temporary)).toEqual([]);
      },
    );
    it("removes its context and Base lock tag when the Docker build fails", () => {
      const f = fixture(),
        built = f.build(undefined, { TEST_BUILD_EXIT: "42" });
      expect(built.result.status).toBe(42);
      expect(readdirSync(f.temporary)).toEqual([]);
      expect(readFileSync(f.trace, "utf8")).toContain(
        "image rm latex-renderer:base-lock-",
      );
    });
    it("keeps a digest-qualified Base instead of creating a local registry alias", () => {
      const f = fixture(),
        digest = `registry.example.test/base@sha256:${"b".repeat(64)}`;
      const built = f.build(undefined, { TEST_REPO_DIGEST: digest });
      expect(built.result.status).toBe(0);
      expect(built.args).toContain(`BASE_IMAGE=${digest}`);
      expect(readFileSync(f.trace, "utf8")).not.toContain("image tag");
    });
    it.each([
      "",
      "installer",
      "mktexlsr",
      "fmtutil-sys",
      "fc-cache",
      "luaotfload-tool",
    ])("keeps stage failure %s fatal despite timing output", (failure) => {
      const f = fixture(),
        built = f.build();
      expect(built.result.status).toBe(0);
      const match =
        /RUN set -eu;([\s\S]*?)\nARG RENDERER_RUNTIME_FINGERPRINT/.exec(
          built.dockerfile,
        );
      if (!match?.[1]) throw new Error("Language RUN is missing");
      const command = `set -eu;${match[1].replace(/\\\n/g, " ").replaceAll("sh /opt/renderer/install-language-packages.sh", 'sh "$TEST_INSTALLER"')}`;
      const run = join(f.root, "run.sh"),
        installer = join(f.root, "installer.sh"),
        stages = join(f.root, "stages");
      writeFileSync(run, command);
      writeFileSync(
        installer,
        '#!/bin/sh\nif [ "$1" = --rebuild-formats ]; then exec fmtutil-sys --all; fi\necho installer >> "$TEST_STAGES"\n[ "$TEST_FAIL" != installer ] || exit 42\n',
      );
      for (const name of [
        "tlmgr",
        "mktexlsr",
        "fmtutil-sys",
        "fc-cache",
        "luaotfload-tool",
      ]) {
        writeFileSync(
          join(f.bin, name),
          `#!/bin/sh
echo '${name}' >> "$TEST_STAGES"
if [ '${name}' = tlmgr ] && [ "$1" = info ]; then
  for argument do language=$argument; done
  printf 'name: %s\\n' "$language"
fi
[ "$TEST_FAIL" != '${name}' ] || exit 42
`,
          { mode: 0o700 },
        );
      }
      const result = spawnSync("sh", [run], {
        encoding: "utf8",
        timeout: 5_000,
        env: {
          ...process.env,
          PATH: `${f.bin}:${process.env.PATH}`,
          TEXLIVE_LANGUAGES: "collection-langenglish collection-langjapanese",
          TEXLIVE_REPOSITORY: "https://snapshot.example.test/2026/10/02/tlnet",
          TEST_STAGES: stages,
          TEST_INSTALLER: installer,
          TEST_FAIL: failure,
        },
      });
      expect(result.status, result.stderr).toBe(failure ? 42 : 0);
      if (!failure) {
        expect(result.stdout).toContain("RUNTIME_LANGUAGE_INSTALL_SECONDS=");
        expect(result.stdout).toContain("RUNTIME_FORMAT_SECONDS=");
        expect(result.stdout).toContain("RUNTIME_FONT_CACHE_SECONDS=");
      } else if (["installer", "mktexlsr", "fmtutil-sys"].includes(failure)) {
        expect(readFileSync(stages, "utf8")).not.toContain("fc-cache");
        expect(result.stdout).not.toContain("RUNTIME_FONT_CACHE_SECONDS=");
      }
    });
  },
);
