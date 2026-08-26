# Migration 006 rollback

Jobs created after this migration can request SVG output. Before rolling back,
stop admission and workers, delete SVG artifact rows and files, then rebuild the
`jobs` and `artifacts` tables without `outputs_json`, `svg`, or `svg_manifest`.
Existing jobs are safe to retain as PDF-only jobs because the migration default
is `["pdf"]`.
