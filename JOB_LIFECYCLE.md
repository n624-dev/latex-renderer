# Job lifecycle

```text
reserved -> uploading -> queued -> validating -> running -> succeeded
    |           |          |          |           +-------> failed/timeout/canceled
    +-----------+----------+----------+-------------------> rejected/expired
terminal -> deleting -> deleted
```

All transitions use compare-and-swap updates inside SQLite transactions. Upload nonces move `unused -> claimed -> consumed`; interrupted claims may be released, while a consumed nonce cannot be replayed. A worker atomically leases one queued job, heartbeats every second, and extends a 30-second lease. At startup it stops an orphaned container and fails that job, or requeues a stale job only when no container exists. Overall job timeout is independent of compile and preview subprocess limits.

Cancellation prevents queued work from entering `running` and stops an active named container. Cleanup enters `deleting`, checks leases, removes job files, then records `deleted`. A retry must be a new job; it never rewrites the original record.

The renderer reports timeout stages separately in Job `errorCode`: `LATEX_COMPILE_TIMEOUT`
for LaTeX, `PREVIEW_TIMEOUT` for PDF inspection/PNG generation, and `SVG_TIMEOUT`
for SVG capture/conversion. Each has terminal Job status `timeout`. The outer
worker deadline takes priority and reports `JOB_TIMEOUT`; other nonzero renderer
exits remain `LATEX_COMPILE_FAILED`. Structured diagnostics and dependencies use
the actual Job entrypoint rather than assuming `main.tex`.
