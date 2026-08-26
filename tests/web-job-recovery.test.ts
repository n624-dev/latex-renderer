import { describe, expect, it } from "vitest";
import { jobTracker } from "../apps/admin-web/src/assets/app-script.js";

const jobId = "job_0123456789abcdef0123456789abcdef";

describe("Web Job recovery", () => {
  it("deduplicates ticket refresh and renews once after an authorization failure", async () => {
    let issues = 0,
      statuses = 0,
      rejectToken = false;
    const fetcher = (input: RequestInfo | URL): Promise<Response> => {
      const path =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (path.endsWith("/access-ticket")) {
        issues += 1;
        return Promise.resolve(
          Response.json({
            jobId,
            jobTicket: `ticket-${issues}-long-enough`,
            expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
          }),
        );
      }
      statuses += 1;
      if (rejectToken) {
        rejectToken = false;
        return Promise.resolve(Response.json({}, { status: 401 }));
      }
      return Promise.resolve(
        Response.json({
          id: jobId,
          status: "running",
          errorCode: null,
          errorMessage: null,
          retentionExpiresAt: null,
          artifacts: [],
          previews: [],
        }),
      );
    };
    const tracker = jobTracker(fetcher, jobId);

    await Promise.all([tracker.get(), tracker.get(), tracker.get()]);
    expect(issues).toBe(1);
    expect(statuses).toBe(3);

    rejectToken = true;
    await expect(tracker.get()).resolves.toMatchObject({ id: jobId });
    expect(issues).toBe(2);
    expect(statuses).toBe(5);
  });
});
