import { setTimeout } from "node:timers/promises";

export const registryProbeImage =
  "docker.io/library/registry@sha256:ddf754342cfc8acc51a56d5d0ab6af06826461864460636d8bd5c546dab2a7b8";

export function dockerObjectMissing(error, kind, target) {
  const prefixes = ["Error: No such object: "];
  prefixes.push(`Error response from daemon: No such ${kind}: `);
  return prefixes.some(
    (prefix) => String(error?.stderr ?? "").trim() === prefix + target,
  );
}

// Only this probe's exact container and nonce-derived synthetic images. Never
// force an image deletion, prune a daemon, or interpret daemon errors as absence.
export async function cleanupBaseIndexProbe({
  run,
  sleep = setTimeout,
  container,
  reference,
  imageIds,
  ownsRegistryImage,
}) {
  if (
    (container !== undefined && !/^[a-f0-9]{64}$/.test(container)) ||
    (reference !== undefined &&
      !/^127\.0\.0\.1:[0-9]+\/fixture@sha256:[a-f0-9]{64}$/.test(reference)) ||
    imageIds.some((id) => !/^sha256:[a-f0-9]{64}$/.test(id))
  )
    throw new Error("Invalid Base index probe cleanup identity");

  if (container !== undefined) {
    let absent = false;
    let removalFailure;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        run(["container", "rm", "--force", container], 5000);
      } catch (error) {
        // --rm may already be removing the same container, or the reply may
        // have been lost. Independently prove absence; never guess from rm.
        removalFailure = error;
      }
      try {
        const actual = run(
          ["container", "inspect", "--format", "{{.Id}}", container],
          5000,
        );
        if (actual !== container)
          throw new Error("Base index probe container identity changed");
      } catch (error) {
        if (!dockerObjectMissing(error, "container", container)) throw error;
        absent = true;
        break;
      }
      if (attempt < 4) await sleep(200);
    }
    if (!absent)
      throw new Error("Base index probe container removal was not confirmed", {
        cause: removalFailure,
      });
  }

  for (const image of new Set([
    ...(reference === undefined ? [] : [reference]),
    ...imageIds,
    ...(ownsRegistryImage ? [registryProbeImage] : []),
  ])) {
    try {
      run(["image", "rm", image], 5000);
    } catch (error) {
      // Containerd may have collected an untagged child with its index.
      if (!dockerObjectMissing(error, "image", image)) throw error;
    }
  }
}
