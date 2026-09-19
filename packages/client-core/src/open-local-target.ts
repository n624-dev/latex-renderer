import { spawn } from "node:child_process";

/** Keep paths/one-time URLs out of PowerShell source and observe its result. */
export async function openLocalTarget(
  target: string,
  options: {
    platform?: NodeJS.Platform;
    spawnProcess?: typeof spawn;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  if (/[\r\n\0]/.test(target)) return false;
  const platform = options.platform ?? process.platform;
  const command =
    platform === "win32"
      ? "powershell.exe"
      : platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    platform === "win32"
      ? [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$ErrorActionPreference='Stop'; Start-Process -FilePath $env:LATEX_RENDER_OPEN_TARGET -ErrorAction Stop",
        ]
      : [target];
  try {
    const child = (options.spawnProcess ?? spawn)(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, LATEX_RENDER_OPEN_TARGET: target },
    });
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.unref();
        resolve(ok);
      };
      const timer = setTimeout(() => {
        child.kill();
        done(false);
      }, options.timeoutMs ?? 10_000);
      child.once("error", () => done(false));
      child.once("exit", (code) => done(code === 0));
    });
  } catch {
    return false;
  }
}
