import { downloadPublishedRelease } from "./published-release.mjs";
import { activateStandaloneHttps } from "./standalone-https.mjs";
import { reportBaselineTransportFailure } from "./baseline-transport-diagnostics.mjs";

export function updateBaselineTag(variant, architecture) {
  // Numeric pieces keep release promotion from rewriting historical identities.
  const tags = {
    legacy: `v${[1, 3, 4].join(".")}-rc.5`,
    installed: `v${[1, 3, 5].join(".")}-rc.1`,
    "native-arm64": `v${[1, 5, 0].join(".")}-rc.1`,
  };
  if (!Object.hasOwn(tags, variant))
    throw new Error("Unknown CI update baseline");
  if ((variant === "native-arm64" ? "arm64" : "x64") !== architecture)
    throw new Error(
      "Update baseline does not match the native host architecture",
    );
  return tags[variant];
}

export async function acquireUpdateBaseline(
  { variant, architecture, stage, apiToken, run },
  {
    download = downloadPublishedRelease,
    activateHttps = activateStandaloneHttps,
    reportFailure = reportBaselineTransportFailure,
  } = {},
) {
  const baselineTag = updateBaselineTag(variant, architecture);
  if (!apiToken)
    throw new Error("CI baseline download requires its read-only API token");
  let baseline;
  try {
    // The real downloader retains immutable identity, checksum, attestation and
    // archive checks. No local fixture DNS entry or HTTPS listener exists yet.
    baseline = await download(baselineTag, stage, { apiToken });
  } catch (error) {
    // Diagnostics must never mask the original failure or turn it into a retry.
    try {
      await reportFailure(error);
    } catch {
      /* preserve the original error */
    }
    throw error;
  }
  await activateHttps(run);
  console.log(
    JSON.stringify({
      event: "release.baseline_acquired_before_https",
      baselineTag,
      architecture,
      commit: baseline.commit,
    }),
  );
  return { baseline, baselineTag };
}
