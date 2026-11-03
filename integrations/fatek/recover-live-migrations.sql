-- Read-only source recovery for the dedicated MS store project.
-- Run in its SQL editor and keep the output private for source review.
-- Does not execute migration contents, create users, change grants or alter data.
SELECT version, name, statements
FROM supabase_migrations.schema_migrations
WHERE version IN ('20261031115850', '20261102224102')
ORDER BY version;
