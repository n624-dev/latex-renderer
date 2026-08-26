import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("LaTeX Renderer Skill entrypoint workflow", () => {
  it("reuses one Source for selected entrypoints without exposing tickets", () => {
    const workflow = read("integrations/latex-renderer/references/workflow.md"),
      security = read("integrations/latex-renderer/references/security.md");

    expect(workflow).toContain("call `upload_source` once");
    expect(workflow).toContain("call `create_render_job` once for each selected");
    expect(workflow).toContain("never API keys or upload/job tickets");
    expect(workflow).toContain("Do not infer that every `.tex` file");
    expect(security).toContain("A Source ID is not a credential");
  });

  it("passes an optional entrypoint through both wrapper scripts", () => {
    const shell = read("integrations/latex-renderer/scripts/render.sh"),
      powershell = read("integrations/latex-renderer/scripts/render.ps1");

    expect(shell).toContain('latex-render render "$1" --entrypoint "$2"');
    expect(powershell).toContain(
      "latex-render render $Project --entrypoint $Entrypoint",
    );
  });
});
