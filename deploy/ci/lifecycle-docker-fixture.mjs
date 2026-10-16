import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This file is copied unchanged into the private worker-readable fixture.
// It has no relative runtime dependencies. Only the installed, fixed module
// is loaded; commands and receipt paths remain argv data, not executable text.
export async function runDockerFixture(args, docker) {
  const [mode, value, ...command] = args;
  if (mode === "cleanup" && value && command.length === 0) {
    await docker.dockerStopVerified(value);
    return;
  }
  if (mode !== "render" || !value || command.length === 0)
    throw new Error("Invalid lifecycle Docker fixture arguments");
  let draining = false;
  const stop = () => {
    draining = true;
  };
  process.on("SIGTERM", stop);
  try {
    await docker.runDocker(command, 60_000);
    await writeFile(value, JSON.stringify({ draining, completed: true }));
  } finally {
    process.off("SIGTERM", stop);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const docker =
    await import("/opt/latex-renderer/current/apps/renderer-worker/dist/docker.js");
  await runDockerFixture(process.argv.slice(2), docker);
}
