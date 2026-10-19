# Migration 21 recovery

Run the standard encrypted backup, restore test and WAL-consistent private-copy
migration preflight before deployment. Verify schema 21 and service health after
the standard update. Do not manually apply this migration to a database where
version 21 is already recorded.

PDF/SVG checkpoints and immutable output generations are one consistency boundary.
Older application code does not implement staged publication or its retention
policy, so `rollbackCompatible` remains false. Do not drop the stage table, remove
migration records, or select a previous application directory on the live host.

Use the standard full recovery point and its matching application, database and
storage state. Stop and verify all writers using the documented recovery procedure,
verify backup checksums and Source/Project preservation, and validate service and
rendering health before resuming traffic. Preserve any unreviewed recovery record
until the recovery outcome has been checked; do not clear it to force another update.
