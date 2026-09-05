const releaseVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;

export function parseReleaseVersion(value) {
  if (typeof value !== "string")
    throw new Error("Release version must use X.Y.Z or X.Y.Z-rc.N");
  const match = releaseVersionPattern.exec(value);
  if (!match) throw new Error("Release version must use X.Y.Z or X.Y.Z-rc.N");
  const numbers = match
    .slice(1, 5)
    .map((part) => (part === undefined ? null : Number(part)));
  if (numbers.some((part) => part !== null && !Number.isSafeInteger(part)))
    throw new Error("Release version contains an unsafe numeric component");
  const [major, minor, patch, candidate] = numbers;
  return {
    value,
    major,
    minor,
    patch,
    candidate,
    prerelease: candidate !== null,
  };
}

export function validReleaseVersion(value) {
  return parseReleaseVersion(value).value;
}

export function validStableVersion(value) {
  const parsed = parseReleaseVersion(value);
  if (parsed.prerelease)
    throw new Error("Stable release version must use X.Y.Z");
  return parsed.value;
}

export function isReleaseCandidate(value) {
  return parseReleaseVersion(value).prerelease;
}

export function assertValidatedCandidateTag(value, releaseVersion) {
  const parsed = parseReleaseVersion(releaseVersion);
  if (parsed.prerelease) {
    if (value !== null)
      throw new Error(
        "Release candidate metadata must not claim another candidate",
      );
    return;
  }
  if (compareReleaseVersions(parsed.value, "1.3.3") < 0) {
    if (value !== null && value !== undefined)
      throw new Error(
        "Legacy stable release metadata has an unexpected candidate tag",
      );
    return;
  }
  if (typeof value !== "string" || !value.startsWith("v"))
    throw new Error(
      "Stable release metadata is missing its validated candidate tag",
    );
  const candidate = parseReleaseVersion(value.slice(1));
  if (
    !candidate.prerelease ||
    candidate.major !== parsed.major ||
    candidate.minor !== parsed.minor ||
    candidate.patch !== parsed.patch
  )
    throw new Error(
      "Stable release metadata has an invalid validated candidate tag",
    );
}

export function compareReleaseVersions(left, right) {
  const a = parseReleaseVersion(left);
  const b = parseReleaseVersion(right);
  for (const component of ["major", "minor", "patch"]) {
    if (a[component] !== b[component])
      return a[component] < b[component] ? -1 : 1;
  }
  if (a.candidate === b.candidate) return 0;
  if (a.candidate === null) return 1;
  if (b.candidate === null) return -1;
  return a.candidate < b.candidate ? -1 : 1;
}
