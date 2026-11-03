import { setTimeout as delay } from "node:timers/promises";

// Disposable acceptance hosts also run the real maintenance timers. A brief
// lock conflict is expected; never retry a deployment or another failure here.
export async function retryCiMutation(
  action,
  { attempts = 60, wait = delay } = {},
) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60)
    throw new Error("CI mutation retry attempts must be 1..60");
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (
        attempt >= attempts ||
        !String(error?.stderr ?? "").includes("code: 'MUTATION_LOCK_BUSY'")
      )
        throw error;
      if (attempt === 1 || attempt % 10 === 0)
        console.log(
          JSON.stringify({
            event: "ci.mutation_lock_deferred",
            attempt,
            attempts,
          }),
        );
      await wait(250);
    }
  }
}
