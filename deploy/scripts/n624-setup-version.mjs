import { parseReleaseVersion } from "./release-version.mjs";

export function selectSetupVersion(packageVersion, candidateTag) {
  const release = parseReleaseVersion(packageVersion.replace("~rc.", "-rc."));
  if (release.value.replace("-rc.", "~rc.") !== packageVersion)
    throw new Error("Unexpected Debian package version");
  if (!release.prerelease) {
    if (candidateTag !== undefined)
      throw new Error("--candidate requires the matching RC package");
    return release.value;
  }

  const tag = `v${release.value}`;
  if (candidateTag === undefined)
    throw new Error(`Use --candidate ${tag} to test the installed RC package`);
  if (candidateTag !== tag)
    throw new Error(`The installed RC package requires --candidate ${tag}`);
  return release.value;
}
