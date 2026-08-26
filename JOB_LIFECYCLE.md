# Job lifecycle

```text
reserved -> uploading -> queued -> validating -> running -> succeeded
    |           |          |          |           +-------> failed/timeout/canceled
    +-----------+----------+----------+-------------------> rejected/expired
terminal -> deleting -> deleted
```

All transitions use compare-and-swap updates inside SQLite transactions. Upload nonces move `unused -> claimed -> consumed`; interrupted claims may be released, while a consumed nonce cannot be replayed. A worker atomically leases one queued job, heartbeats every second, and extends a 30-second lease. At startup it stops an orphaned container and fails that job, or requeues a stale job only when no container exists. Overall job timeout is independent of compile and preview subprocess limits.

Cancellation prevents queued work from entering `running` and stops an active named container. Cleanup enters `deleting`, checks leases, removes job files, then records `deleted`. A retry must be a new job; it never rewrites the original record.
