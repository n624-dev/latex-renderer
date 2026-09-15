# Audit export sequence (migration 18)

The migration adds a singleton database identity, an AUTOINCREMENT sequence
ledger, and audit INSERT/DELETE/append-only triggers. Retained rows receive
sequences in `(created_at,id)` order once; subsequent rows use insertion order,
even for equal or backdated timestamps. Tokens distinguish sequences reused on
a restored database branch. Runtime and numbered SQL forms are equivalent and
idempotent. No exported log, existing audit row or storage object is deleted by
this migration.

Before application migration, stop the audit export and cleanup timers/services,
drain application writers, take the required encrypted DB/storage recovery point
and verify it. Run the private-copy migration preflight and require target 18,
integrity and foreign-key success. Deploy application, exporter and cleanup
together. Resume export and confirm the first bounded legacy replay; run again
if `backlogMayRemain` is true. Resume cleanup after validating export/checkpoint.
The default daily export schedule can take multiple runs to drain a large backlog;
do not raise bounded batch settings without checking memory/disk capacity.

This is a forward-only change. Keep `deploy/release-policy.json` rollbackCompatible
false. Older exporters/cleanup cannot interpret the new checkpoint and must not
be substituted independently. Do not drop the sequence tables/triggers or reset
`sqlite_sequence` to force a downgrade. Restore the pre-upgrade DB and matching
storage with the corresponding application under the established maintenance
procedure. Preserve post-upgrade encrypted exports; a DB rollback cannot recreate
later rows. Application-only rollback is not supported.

A restored DB can have the same database identity but diverge at a sequence;
the checkpoint token detects that case. A newer/mismatched/corrupt checkpoint
stops audit export and pruning. Preserve both state versions, then follow the
[explicit replay procedure](../../OPERATIONS.md#audit-export-sequence-and-recovery)
if no trustworthy matching checkpoint is available. Do not infer acknowledged
rows from timestamps. Replay may duplicate old exports and cannot recover records
already absent from the DB. It requires operator review, not an automatic repair.
