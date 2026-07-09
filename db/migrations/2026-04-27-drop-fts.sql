-- Drop FTS5 virtual table and triggers.
--
-- Why: Cloudflare D1 currently has a known issue where FTS5 shadow tables
-- (posts_fts_data / posts_fts_idx / posts_fts_docsize / posts_fts_config) can
-- drift out of sync with the content table, causing every subsequent UPDATE
-- posts to fail with `SQLITE_CORRUPT (extended: SQLITE_CORRUPT_VTAB)` because
-- the posts_au trigger fires on each save.
--
-- Reference: https://github.com/emdash-cms/emdash/issues/252
--
-- Impact: Search falls back to the LIKE branch in lib/repositories/search.ts
-- which is already implemented and gracefully covers the current dataset
-- size. Re-enable FTS5 via db/migrations/enable-fts.sql once D1's FTS5
-- support matures.
--
-- Apply on remote: npx wrangler d1 execute DB --remote --file=db/migrations/2026-04-27-drop-fts.sql -c wrangler.local.toml

DROP TRIGGER IF EXISTS posts_ai;
DROP TRIGGER IF EXISTS posts_au;
DROP TRIGGER IF EXISTS posts_ad;
DROP TABLE IF EXISTS posts_fts;
