import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { AppError } from "@latex-renderer/shared";
import type { JobResponse } from "@latex-renderer/contracts";
import type { ClientTransport } from "../packages/client-core/src/index.js";
import { pollUntilTerminal } from "../packages/client-core/src/polling.js";

const ticket = () => ({ jobId: "job_test", jobTicket: "old", expiresAt: new Date(Date.now() + 1_800_000).toISOString() });
const completed = { id: "job_test", status: "succeeded" } as JobResponse;
function transport(job: ClientTransport["job"], renewJobTicket: ClientTransport["renewJobTicket"] = () => Promise.resolve({ jobTicket: "new", expiresAt: new Date(Date.now() + 1_800_000).toISOString() })) {
  return { job, renewJobTicket };
}

describe("polling deadlines and ticket renewal", () => {
  it.each([502, 503, 504])("retries transient HTTP %s on status reads without renewing a ticket", async status => {
    let requests = 0, renewals = 0;
    const delays: number[] = [];
    const result = await pollUntilTerminal(transport(() => {
      if (++requests <= 2) return Promise.reject(new AppError("INVALID_RESPONSE", "invalid JSON", status));
      return Promise.resolve(completed);
    }, () => { renewals++; throw new Error("Renewal must not run"); }), ticket(), {
      sleep: milliseconds => { delays.push(milliseconds); return Promise.resolve(); },
    });
    assert.equal(result.job.status, "succeeded");
    assert.equal(requests, 3);
    assert.equal(renewals, 0);
    assert.deepEqual(delays, [1000, 2000]);
  });

  it("stops after five retries even without an overall timeout", async () => {
    let requests = 0;
    const delays: number[] = [], failure = new AppError("HTTP_ERROR", "Unavailable", 503);
    await assert.rejects(pollUntilTerminal(transport(() => {
      requests++; return Promise.reject(failure);
    }), ticket(), { sleep: milliseconds => { delays.push(milliseconds); return Promise.resolve(); } }), error => error === failure);
    assert.equal(requests, 6);
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 8000]);
  });

  it.each([
    ["INVALID_RESPONSE", 200], ["INVALID_RESPONSE", 400], ["HTTP_ERROR", 401],
    ["HTTP_ERROR", 403], ["HTTP_ERROR", 404], ["HTTP_ERROR", 429],
    ["ARTIFACT_INTEGRITY_MISMATCH", 502], ["TICKET_REVOKED", 401],
  ] as const)("does not retry %s / %s", async (code, status) => {
    let requests = 0;
    const failure = new AppError(code, "permanent failure", status);
    await assert.rejects(pollUntilTerminal(transport(() => {
      requests++; return Promise.reject(failure);
    }), ticket(), { sleep: () => { throw new Error("No backoff expected"); } }), error => error === failure);
    assert.equal(requests, 1);
  });

  it("does not hide unexpected transport exceptions", async () => {
    const failure = new TypeError("custom transport bug");
    let requests = 0;
    await assert.rejects(pollUntilTerminal(transport(() => {
      requests++; throw failure;
    }), ticket(), {}), error => error === failure);
    assert.equal(requests, 1);
  });

  it("bounds retry sleep by the polling deadline", async () => {
    await assert.rejects(pollUntilTerminal(transport(() => Promise.reject(new AppError("INVALID_RESPONSE", "invalid JSON", 502))), ticket(), {
      pollTimeoutMs: 20,
    }), { code: "RENDER_POLL_TIMEOUT" });
  });

  it("rechecks an injected deadline before another retry request", async () => {
    let time = Date.now(), requests = 0;
    await assert.rejects(pollUntilTerminal(transport(() => {
      requests++; return Promise.reject(new AppError("HTTP_ERROR", "Unavailable", 503));
    }), ticket(), { now: () => time, pollTimeoutMs: 500, sleep: delay => { time += delay; return Promise.resolve(); } }), { code: "RENDER_POLL_TIMEOUT" });
    assert.equal(requests, 1);
  });

  it("retries a status read after renewal but never retries failed renewal itself", async () => {
    let requests = 0, renewals = 0;
    const result = await pollUntilTerminal(transport((_id, token) => {
      requests++;
      if (requests === 1) return Promise.reject(new AppError("INVALID_TICKET", "expired", 401));
      assert.equal(token, "new");
      if (requests === 2) return Promise.reject(new AppError("HTTP_ERROR", "Unavailable", 504));
      return Promise.resolve(completed);
    }, () => { renewals++; return Promise.resolve({ jobTicket: "new", expiresAt: ticket().expiresAt }); }), ticket(), { sleep: () => Promise.resolve() });
    assert.equal(result.jobTicket, "new");assert.equal(requests, 3);assert.equal(renewals, 1);
    renewals = 0;
    await assert.rejects(pollUntilTerminal(transport(() => Promise.reject(new AppError("INVALID_TICKET", "expired", 401)), () => {
      renewals++; return Promise.reject(new AppError("HTTP_ERROR", "Unavailable", 502));
    }), ticket(), {}), { code: "HTTP_ERROR", status: 502 });
    assert.equal(renewals, 1);
  });

  it("resets the retry budget after a valid status response", async () => {
    let requests = 0;
    const result = await pollUntilTerminal(transport(() => {
      requests++;
      if (requests % 6 !== 0) return Promise.reject(new AppError("HTTP_ERROR", "Unavailable", 503));
      return Promise.resolve(requests === 6 ? { ...completed, status: "running" } : completed);
    }), ticket(), { sleep: () => Promise.resolve() });
    assert.equal(result.job.status, "succeeded");assert.equal(requests, 12);
  });

  it("renews before expiry and returns the ticket used for final status", async () => {
    let time = Date.now();
    const initial = ticket(), seen: string[] = [];
    const result = await pollUntilTerminal(transport((_id, token) => {
      seen.push(token);
      return Promise.resolve(seen.length === 1 ? { ...completed, status: "queued" } : completed);
    }, () => Promise.resolve({ jobTicket: "new", expiresAt: new Date(time + 1_800_000).toISOString() })), initial, {
      now: () => time,
      sleep: () => { time += 1_770_000; return Promise.resolve(); },
    });
    assert.deepEqual(seen, ["old", "new"]);
    assert.equal(result.jobTicket, "new");
  });

  it("refreshes one expired-ticket response", async () => {
    let requests = 0;
    const result = await pollUntilTerminal(transport((_id, token) => {
      if (++requests === 1) return Promise.reject(new AppError("INVALID_TICKET", "expired", 401));
      assert.equal(token, "new");
      return Promise.resolve(completed);
    }), ticket(), {});
    assert.equal(requests, 2);
    assert.equal(result.jobTicket, "new");
  });

  it("does not refresh revoked authorization", async () => {
    let renewals = 0;
    await assert.rejects(pollUntilTerminal(transport(() => {
      return Promise.reject(new AppError("TICKET_REVOKED", "revoked", 401));
    }, () => {
      renewals++;
      return Promise.resolve({ jobTicket: "new", expiresAt: ticket().expiresAt });
    }), ticket(), {}), { code: "TICKET_REVOKED" });
    assert.equal(renewals, 0);
  });

  it("does not loop when the refreshed ticket is also rejected", async () => {
    let requests = 0, renewals = 0;
    await assert.rejects(pollUntilTerminal(transport(() => {
      requests++;
      return Promise.reject(new AppError("INVALID_TICKET", "expired", 401));
    }, () => {
      renewals++;
      return Promise.resolve({ jobTicket: "new", expiresAt: ticket().expiresAt });
    }), ticket(), {}), { code: "INVALID_TICKET" });
    assert.equal(requests, 2);
    assert.equal(renewals, 1);
  });

  it("aborts a stalled status request even if the transport ignores cancellation", async () => {
    let signal: AbortSignal | undefined;
    await assert.rejects(pollUntilTerminal(transport((_id, _token, options) => {
      signal = options?.signal;
      return new Promise<JobResponse>(() => undefined);
    }), ticket(), { pollTimeoutMs: 20 }), { code: "RENDER_POLL_TIMEOUT", status: 504 });
    assert.equal(signal?.aborted, true);
  });

  it("also bounds a stalled renewal", async () => {
    let signal: AbortSignal | undefined;
    await assert.rejects(pollUntilTerminal(transport(() => Promise.resolve(completed), (_id, options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
    }), { ...ticket(), expiresAt: new Date(Date.now() - 1000).toISOString() }, { pollTimeoutMs: 20 }), { code: "RENDER_POLL_TIMEOUT" });
    assert.equal(signal?.aborted, true);
  });

  it("interrupts the default polling sleep", async () => {
    await assert.rejects(pollUntilTerminal(transport(() => Promise.resolve({ ...completed, status: "queued" })), ticket(), {
      pollTimeoutMs: 20, pollIntervalMs: 10_000,
    }), { code: "RENDER_POLL_TIMEOUT" });
  });

  it("interrupts a stalled custom sleep", async () => {
    await assert.rejects(pollUntilTerminal(transport(() => Promise.resolve({ ...completed, status: "queued" })), ticket(), {
      pollTimeoutMs: 20, sleep: () => new Promise<void>(() => undefined),
    }), { code: "RENDER_POLL_TIMEOUT" });
  });

  it("keeps a far-future deadline from overflowing Node timers", async () => {
    const result = await pollUntilTerminal(transport(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return completed;
    }), ticket(), { pollTimeoutMs: 2_147_483_648 });
    assert.equal(result.job.status, "succeeded");
  });
});
