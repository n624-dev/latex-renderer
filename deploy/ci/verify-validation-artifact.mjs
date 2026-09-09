import { verifyCiValidationArtifact } from "../scripts/ci-release-artifact.mjs";
if (process.argv.length !== 8)
  throw new Error(
    "usage: verify-validation-artifact.mjs ARTIFACT TAG COMMIT DIGEST PROOF SOURCE_REF",
  );
const [artifact, tag, commit, digest, attestationBundle, sourceRef] =
  process.argv.slice(2);
console.log(
  JSON.stringify(
    await verifyCiValidationArtifact({
      artifact,
      tag,
      commit,
      digest,
      attestationBundle,
      sourceRef,
    }),
  ),
);
