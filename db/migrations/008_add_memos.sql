-- Short posts written on www.qiaomu.ai/notes/. Also created at runtime by ensureMemosTable().
CREATE TABLE IF NOT EXISTS memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  html TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private',
  syndication_json TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_memos_visibility_created ON memos(visibility, created_at DESC);
