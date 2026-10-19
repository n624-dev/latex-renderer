# Migration 22 recovery

This migration adds a PDF-bound preview document and a bounded, fenced request
queue. It does not rewrite historical PDFs, previews, Sources or Job states.
Deploy the Worker and all preview consumers together, after the encrypted backup,
restore trial and private-copy migration preflight have succeeded.

Application-only downgrade remains unsupported (`rollbackCompatible: false`).
Restore a verified full recovery point with its matching application, database
and storage, after stopping and verifying all writers. Do not drop these tables
or edit migration records on the live database to force a downgrade.

After recovery, verify database integrity, retained PDF hashes, user ownership,
artifact retention, preview requests, service health and a fresh render.
