# Migration 004 rollback

Stop the Remote MCP service first. Restoring the pre-migration encrypted backup is the supported rollback because authorization-code, rotating-token, Source reference, and audit state must remain consistent. Do not drop these tables from a live database.
