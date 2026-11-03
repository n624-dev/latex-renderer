import { execFileSync } from "node:child_process";
import { it } from "vitest";

it.skipIf(process.platform !== "linux")(
  "serves bounded passive health with no application or engine startup",
  () => {
    execFileSync("python3", ["-B", "tests/passive_health_test.py", "-q"], {
      timeout: 15000,
      stdio: "pipe",
    });
  },
);
