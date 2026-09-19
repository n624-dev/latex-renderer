import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLocalTarget } from "./open-local-target.js";

afterEach(() => vi.useRealTimers());
function fake() {
  const child = Object.assign(new EventEmitter(), {
    unref: vi.fn(),
    kill: vi.fn(),
  });
  const start = vi.fn(() => child) as unknown as typeof spawn;
  return { child, start };
}
describe("native PDF and browser opener", () => {
  it.runIf(process.platform === "win32")(
    "checks the Windows PowerShell cmdlet signature and real process exit without opening a UI",
    async () => {
      const signature = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "if(!(Get-Command Microsoft.PowerShell.Management\\Start-Process).Parameters.ContainsKey('FilePath')){exit 1}",
        ],
        { encoding: "utf8", timeout: 15_000 },
      );
      expect(signature.status, signature.stderr).toBe(0);
      const run = ((
        command: string,
        args: string[],
        options: import("node:child_process").SpawnOptions,
      ) =>
        spawn(
          command,
          [
            ...args.slice(0, -1),
            `function Start-Process { [CmdletBinding()]param([Parameter(Mandatory)][string]$FilePath) if($FilePath -ne $env:LATEX_RENDER_OPEN_TARGET){throw 'target mismatch'} }; ${args.at(-1) ?? ""}`,
          ],
          options,
        )) as typeof spawn;
      expect(
        await openLocalTarget("C:\\日本語 & [a] 'quote'.pdf", {
          spawnProcess: run,
        }),
      ).toBe(true);
    },
  );
  it.each([
    "C:\\files\\a '& test.pdf",
    "http://127.0.0.1:1234/#one-time-token",
  ])(
    "uses supported PowerShell arguments and waits for exit: %s",
    async (target) => {
      const f = fake();
      let finished = false;
      const result = openLocalTarget(target, {
        platform: "win32",
        spawnProcess: f.start,
      }).then((ok) => {
        finished = true;
        return ok;
      });
      f.child.emit("spawn");
      await Promise.resolve();
      expect(finished).toBe(false);
      const invocation = vi.mocked(f.start).mock.calls[0] as unknown as [
        string,
        string[],
        { env: NodeJS.ProcessEnv },
      ];
      expect(invocation[0]).toBe("powershell.exe");
      expect(invocation[1].at(-1)).toContain("Start-Process -FilePath");
      expect(invocation[2].env.LATEX_RENDER_OPEN_TARGET).toBe(target);
      expect(
        JSON.stringify(vi.mocked(f.start).mock.calls[0]?.[1]),
      ).not.toContain(target);
      f.child.emit("exit", 0, null);
      expect(await result).toBe(true);
    },
  );
  it("reports argument-binding and missing-launcher failures", async () => {
    for (const event of ["error", "exit"] as const) {
      const f = fake(),
        result = openLocalTarget("test.pdf", {
          platform: "win32",
          spawnProcess: f.start,
        });
      f.child.emit(event, event === "error" ? new Error("missing") : 1);
      expect(await result).toBe(false);
    }
  });
  it("bounds a launcher that never returns", async () => {
    vi.useFakeTimers();
    const f = fake();
    const result = openLocalTarget("test.pdf", {
      spawnProcess: f.start,
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe(false);
    expect(f.child.kill).toHaveBeenCalledOnce();
  });
});
