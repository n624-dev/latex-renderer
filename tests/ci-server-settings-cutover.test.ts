import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("uses the installed settings CLI and checks the real Gateway before the post-update render", () => {
  const script = readFileSync("deploy/ci/update-e2e.mjs", "utf8");
  const cutover = script.indexOf(
    "const originalReview = importServerSetupReview",
  );
  const apply = script.indexOf('"--setup-apply"', cutover);
  const gateway = script.indexOf(
    '"latex-renderer-standalone-gateway.service"',
    apply,
  );
  const health = script.indexOf('"http://127.0.0.1:3105/health"', gateway);
  const restored = script.indexOf(
    "Settings cutover did not restore the original review",
    health,
  );
  const render = script.indexOf(
    "/deploy/scripts/smoke-test-production.sh",
    restored,
  );
  expect(cutover).toBeGreaterThan(
    script.indexOf("CI host marker does not match this run/boot"),
  );
  expect(apply).toBeGreaterThan(cutover);
  expect(gateway).toBeGreaterThan(apply);
  expect(health).toBeGreaterThan(gateway);
  expect(restored).toBeGreaterThan(health);
  expect(render).toBeGreaterThan(restored);
  expect(script).toContain("[originalQueue + 1, originalQueue]");
  expect(script).toContain("{ mode: 0o600 }");
  expect(script).toContain("settingsCutover: true");
  expect(script).toContain("gatewayReady: true");
});
