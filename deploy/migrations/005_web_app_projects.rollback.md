# Migration 005 rollback

This migration adds user-facing Project metadata without moving Source or Job
bytes. Rollback requires a maintenance window because SQLite cannot remove the
`jobs.project_revision_id` column safely while services are running.

1. Stop all LaTeX Renderer services and take an encrypted backup.
2. Create a replacement `jobs` table using the migration-004 schema, copy all
   columns except `project_revision_id`, and replace the current table.
3. Drop `project_revisions`, `projects`, and `web_principals` in that order.
4. Delete schema migration version 5, run `PRAGMA foreign_key_check`, and only
   then restart services.

Project names and revision associations are metadata only; Source and Job
records remain governed by their existing retention policy.
