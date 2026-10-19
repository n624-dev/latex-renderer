import { Script } from "node:vm";
import { expect, it, vi } from "vitest";
import { part5 } from "../apps/admin-web/src/assets/admin-script-parts/part-5.js";

it("opens the new administrator Job using the retry route's id response", async () => {
  const source = part5
    .split("\n")
    .find((line) => line.startsWith("function bindJobMutations()"));
  if (!source) throw new Error("Missing Job mutation handler");
  type RetryDialog = {
    reload: boolean;
    onSubmit: () => Promise<unknown>;
    afterSuccess: (result: unknown) => void;
  };
  const dialogs: RetryDialog[] = [];
  const response = { id: "job_new", retryOfJobId: "job_original" },
    request = vi.fn().mockResolvedValue(response),
    assign = vi.fn();
  new Script(source + "\nbindJobMutations();").runInNewContext({
    bindSvgRetryMutations() {},
    bindAction(selector: string, handler: (button: unknown) => void) {
      if (selector === "[data-j-retry]")
        handler({ dataset: { jRetry: "job_original" } });
    },
    confirmDialog(value: RetryDialog) {
      dialogs.push(value);
    },
    request,
    crypto: { randomUUID: () => "fixture-idempotency-key" },
    location: { assign },
    encodeURIComponent,
  });
  const dialog = dialogs[0];
  if (!dialog) throw new Error("Missing retry confirmation");
  expect(dialog.reload).toBe(false);
  const result = await dialog.onSubmit();
  expect(request).toHaveBeenCalledWith("/jobs/job_original/retry", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "fixture-idempotency-key",
    },
    body: "{}",
  });
  dialog.afterSuccess(result);
  expect(assign).toHaveBeenCalledExactlyOnceWith("/admin/jobs/?job=job_new");
});
