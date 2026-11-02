import type { Database } from '@/lib/repositories/schema'

// Memos are short posts (like a personal Twitter / Flomo) written on www.qiaomu.ai/notes/.
// They live apart from `posts` so they never show up in the blog's lists, feed or sitemap.

export const MEMO_VISIBILITIES = ['private', 'unlisted', 'public'] as const
export type MemoVisibility = (typeof MEMO_VISIBILITIES)[number]

export interface Memo {
  id: number
  slug: string
  html: string
  text: string
  visibility: MemoVisibility
  syndication: Record<string, string>
  created_at: number
  updated_at: number
}

interface MemoRow {
  id: number
  slug: string
  html: string
  text: string
  visibility: string
  syndication_json: string | null
  created_at: number
  updated_at: number
}

let memosTableReady = false

export async function ensureMemosTable(db: Database) {
  if (memosTableReady) return
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS memos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        html TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'private',
        syndication_json TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,
    )
    .run()
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_memos_visibility_created ON memos(visibility, created_at DESC)')
    .run()
  memosTableReady = true
}

export function isMemoVisibility(value: unknown): value is MemoVisibility {
  return typeof value === 'string' && (MEMO_VISIBILITIES as readonly string[]).includes(value)
}

function parseSyndication(value: string | null): Record<string, string> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function mapMemo(row: MemoRow): Memo {
  return {
    id: row.id,
    slug: row.slug,
    html: row.html,
    text: row.text,
    visibility: isMemoVisibility(row.visibility) ? row.visibility : 'private',
    syndication: parseSyndication(row.syndication_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// Short, time-ordered and unguessable enough for unlisted links: base36 seconds + 4 random chars.
export function generateMemoSlug(now = Date.now()) {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) => (byte % 36).toString(36)).join('')
  return `${Math.floor(now / 1000).toString(36)}${random}`
}

export interface ListMemosOptions {
  visibilities: readonly MemoVisibility[]
  limit?: number
  before?: number | null
}

export async function listMemos(db: Database, options: ListMemosOptions): Promise<Memo[]> {
  await ensureMemosTable(db)
  if (options.visibilities.length === 0) return []
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500)
  const placeholders = options.visibilities.map(() => '?').join(', ')
  const binds: unknown[] = [...options.visibilities]
  let where = `visibility IN (${placeholders})`
  if (options.before) {
    where += ' AND created_at < ?'
    binds.push(options.before)
  }
  const { results } = await db
    .prepare(`SELECT * FROM memos WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...binds, limit)
    .all<MemoRow>()
  return (results ?? []).map(mapMemo)
}

export async function getMemoBySlug(db: Database, slug: string): Promise<Memo | null> {
  await ensureMemosTable(db)
  const row = await db.prepare('SELECT * FROM memos WHERE slug = ?').bind(slug).first<MemoRow>()
  return row ? mapMemo(row) : null
}

export interface MemoWriteInput {
  html?: string
  text?: string
  visibility?: MemoVisibility
  syndication?: Record<string, string>
}

export async function createMemo(db: Database, input: MemoWriteInput): Promise<Memo> {
  await ensureMemosTable(db)
  const now = Math.floor(Date.now() / 1000)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = generateMemoSlug()
    try {
      await db
        .prepare(
          `INSERT INTO memos (slug, html, text, visibility, syndication_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          slug,
          input.html ?? '',
          input.text ?? '',
          input.visibility ?? 'private',
          input.syndication ? JSON.stringify(input.syndication) : null,
          now,
          now,
        )
        .run()
      const memo = await getMemoBySlug(db, slug)
      if (memo) return memo
    } catch (error) {
      if (attempt === 2 || !String(error).includes('UNIQUE')) throw error
    }
  }
  throw new Error('无法生成唯一的 memo slug')
}

export async function updateMemo(db: Database, slug: string, input: MemoWriteInput): Promise<Memo | null> {
  await ensureMemosTable(db)
  const sets: string[] = []
  const binds: unknown[] = []
  if (input.html !== undefined) {
    sets.push('html = ?')
    binds.push(input.html)
  }
  if (input.text !== undefined) {
    sets.push('text = ?')
    binds.push(input.text)
  }
  if (input.visibility !== undefined) {
    sets.push('visibility = ?')
    binds.push(input.visibility)
  }
  if (input.syndication !== undefined) {
    sets.push('syndication_json = ?')
    binds.push(JSON.stringify(input.syndication))
  }
  if (sets.length > 0) {
    sets.push("updated_at = strftime('%s', 'now')")
    await db.prepare(`UPDATE memos SET ${sets.join(', ')} WHERE slug = ?`).bind(...binds, slug).run()
  }
  return getMemoBySlug(db, slug)
}

export async function deleteMemo(db: Database, slug: string): Promise<boolean> {
  await ensureMemosTable(db)
  const result = await db.prepare('DELETE FROM memos WHERE slug = ?').bind(slug).run()
  return ((result.meta as { changes?: number } | undefined)?.changes ?? 0) > 0
}
