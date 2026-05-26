-- Re-enable FTS5 on posts (idempotent).
--
-- Only apply this once Cloudflare D1's FTS5 support is stable.
-- See db/migrations/2026-04-27-drop-fts.sql for why it's currently disabled.
--
-- Apply on remote: npx wrangler d1 execute DB --remote --file=db/migrations/enable-fts.sql -c wrangler.local.toml

DROP TRIGGER IF EXISTS posts_ai;
DROP TRIGGER IF EXISTS posts_au;
DROP TRIGGER IF EXISTS posts_ad;
DROP TABLE IF EXISTS posts_fts;

CREATE VIRTUAL TABLE posts_fts USING fts5(
  title,
  content,
  content=posts,
  content_rowid=id,
  tokenize='unicode61'
);

INSERT INTO posts_fts(rowid, title, content)
  SELECT id, title, content FROM posts;

CREATE TRIGGER posts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER posts_au AFTER UPDATE ON posts BEGIN
  UPDATE posts_fts SET title = new.title, content = new.content
  WHERE rowid = new.id;
END;

CREATE TRIGGER posts_ad AFTER DELETE ON posts BEGIN
  DELETE FROM posts_fts WHERE rowid = old.id;
END;
