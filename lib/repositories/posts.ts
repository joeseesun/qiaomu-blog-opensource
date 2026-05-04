import { getCacheKey } from '@/lib/cache'
import { mapPostWithTags, parsePostTags } from '@/lib/repositories/post-mappers'
import { ensureSchema, type Database } from '@/lib/repositories/schema'
import type {
  CountRow,
  Post,
  PostAiSnapshotRow,
  PostCategoryRow,
  PostWithTags,
  StatsRow,
} from '@/lib/repositories/types'

// 获取文章列表（默认只返回已发布文章）
export async function getPosts(
  db: Database,
  limit = 50,
  offset = 0,
  includeDrafts = false,
  includeEncrypted = false,
  includeHidden = false,
  includeDeleted = false,
): Promise<PostWithTags[]> {
  await ensureSchema(db)
  const conditions: string[] = []
  if (!includeDrafts) {
    conditions.push("status = 'published'")
  }
  if (!includeDeleted) {
    conditions.push('deleted_at IS NULL')
  }
  if (!includeEncrypted) {
    conditions.push('password IS NULL')
  }
  if (!includeHidden) {
    conditions.push('is_hidden = 0')
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const { results } = await db
    .prepare(
      `SELECT id, slug, title, description, category, tags, status, password, is_pinned, is_hidden, cover_image, published_at, view_count
       , deleted_at
       FROM posts
       ${where}
       ORDER BY is_pinned DESC, published_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<Post>()

  return results.map(mapPostWithTags)
}

// 根据 slug 获取文章（调用方可选传入公共 KV 缓存）
export async function getPostBySlug(
  db: Database,
  slug: string,
  kv?: KVNamespace,
): Promise<PostWithTags | null> {
  await ensureSchema(db)

  if (kv) {
    try {
      const cacheKey = await getCacheKey(kv, `post:${slug}`)
      const cached = await kv.get(cacheKey, 'json')
      if (cached) {
        return cached as PostWithTags
      }
    } catch {
      // 缓存读取失败，继续查询数据库
    }
  }

  const post = await db
    .prepare('SELECT * FROM posts WHERE slug = ?')
    .bind(slug)
    .first<Post>()

  if (!post) return null

  const result = mapPostWithTags(post)

  if (kv) {
    getCacheKey(kv, `post:${slug}`)
      .then((cacheKey) => kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 3600 }))
      .catch(() => {})
  }

  return result
}

export async function getPostAiSnapshot(
  db: Database,
  id: number,
): Promise<{
  id: number
  title: string
  content: string
  category: string | null
  description: string | null
  tags: string[]
  deleted_at: number | null
} | null> {
  await ensureSchema(db)

  const post = await db
    .prepare('SELECT id, title, content, category, description, tags, deleted_at FROM posts WHERE id = ?')
    .bind(id)
    .first<PostAiSnapshotRow>()

  if (!post) return null

  return {
    ...post,
    tags: parsePostTags(post.tags),
  }
}

// 创建文章
export async function createPost(
  db: Database,
  data: {
    slug: string
    title: string
    content: string
    html: string
    description?: string
    category?: string
    tags?: string[]
    status?: 'draft' | 'published'
    password?: string | null
    is_hidden?: number
    cover_image?: string | null
  },
): Promise<number> {
  await ensureSchema(db)
  const category = data.category || '未分类'

  const result = await db
    .prepare(
      `INSERT INTO posts (slug, title, content, html, description, category, tags, status, password, is_hidden, cover_image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      data.slug,
      data.title,
      data.content,
      data.html,
      data.description || null,
      category,
      data.tags ? JSON.stringify(data.tags) : null,
      data.status || 'published',
      data.password ?? null,
      data.is_hidden ?? 0,
      data.cover_image ?? null,
    )
    .run()

  await db
    .prepare(
      `UPDATE categories
       SET post_count = post_count + 1
       WHERE name = ?`,
    )
    .bind(category)
    .run()

  return result.meta.last_row_id
}

// 按 slug 更新文章（用于自动保存）
export async function updatePostBySlug(
  db: Database,
  slug: string,
  data: Partial<{
    slug: string
    title: string
    content: string
    html: string
    description: string
    category: string
    tags: string[]
    status: 'draft' | 'published' | 'deleted'
    password: string | null
    is_pinned: number
    is_hidden: number
    cover_image: string | null
  }>,
): Promise<void> {
  await ensureSchema(db)

  const post = await db
    .prepare('SELECT id, category FROM posts WHERE slug = ?')
    .bind(slug)
    .first<{ id: number; category: string }>()

  if (!post) {
    throw new Error('文章不存在')
  }

  await updatePost(db, post.id, data)
}

// 更新文章
export async function updatePost(
  db: Database,
  id: number,
  data: Partial<{
    slug: string
    title: string
    content: string
    html: string
    description: string
    category: string
    tags: string[]
    status: 'draft' | 'published' | 'deleted'
    password: string | null
    is_pinned: number
    is_hidden: number
    cover_image: string | null
  }>,
): Promise<void> {
  await ensureSchema(db)

  let oldCategory: string | null = null
  if (data.category !== undefined) {
    const post = await db
      .prepare('SELECT category, deleted_at FROM posts WHERE id = ?')
      .bind(id)
      .first<PostCategoryRow>()
    oldCategory = post?.category || null
  }

  const updates: string[] = []
  const values: unknown[] = []

  if (data.slug !== undefined) {
    updates.push('slug = ?')
    values.push(data.slug)
  }
  if (data.title !== undefined) {
    updates.push('title = ?')
    values.push(data.title)
  }
  if (data.content !== undefined) {
    updates.push('content = ?')
    values.push(data.content)
  }
  if (data.html !== undefined) {
    updates.push('html = ?')
    values.push(data.html)
  }
  if (data.description !== undefined) {
    updates.push('description = ?')
    values.push(data.description)
  }
  if (data.category !== undefined) {
    updates.push('category = ?')
    values.push(data.category)
  }
  if (data.tags !== undefined) {
    updates.push('tags = ?')
    values.push(JSON.stringify(data.tags))
  }
  if (data.status !== undefined) {
    if (data.status === 'deleted') {
      updates.push("deleted_at = COALESCE(deleted_at, strftime('%s', 'now'))")
    } else {
      updates.push('status = ?')
      values.push(data.status)
      updates.push('deleted_at = NULL')
    }
  }
  if (data.password !== undefined) {
    updates.push('password = ?')
    values.push(data.password)
  }
  if (data.is_pinned !== undefined) {
    updates.push('is_pinned = ?')
    values.push(data.is_pinned)
  }
  if (data.is_hidden !== undefined) {
    updates.push('is_hidden = ?')
    values.push(data.is_hidden)
  }
  if (data.cover_image !== undefined) {
    updates.push('cover_image = ?')
    values.push(data.cover_image)
  }

  if (updates.length === 0) return

  updates.push("updated_at = strftime('%s', 'now')")
  values.push(id)

  await db
    .prepare(`UPDATE posts SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()

  if (data.category !== undefined && oldCategory !== null && oldCategory !== data.category) {
    await db
      .prepare('UPDATE categories SET post_count = post_count - 1 WHERE name = ?')
      .bind(oldCategory)
      .run()
    await db
      .prepare('UPDATE categories SET post_count = post_count + 1 WHERE name = ?')
      .bind(data.category)
      .run()
  }
}

// 增加浏览量
export async function incrementViewCount(db: Database, slug: string): Promise<void> {
  await db
    .prepare('UPDATE posts SET view_count = view_count + 1 WHERE slug = ?')
    .bind(slug)
    .run()
}

// 删除文章
export async function deletePost(db: Database, slug: string): Promise<void> {
  const post = await db
    .prepare('SELECT category FROM posts WHERE slug = ?')
    .bind(slug)
    .first<PostCategoryRow>()

  await db.prepare('DELETE FROM posts WHERE slug = ?').bind(slug).run()

  if (post?.category) {
    await db
      .prepare('UPDATE categories SET post_count = post_count - 1 WHERE name = ?')
      .bind(post.category)
      .run()
  }
}

// 获取统计数据
export async function getStats(
  db: Database,
): Promise<{ total_posts: number; total_views: number }> {
  const result = await db
    .prepare('SELECT COUNT(*) as total_posts, COALESCE(SUM(view_count), 0) as total_views FROM posts WHERE deleted_at IS NULL')
    .first<StatsRow>()
  return {
    total_posts: (result?.total_posts as number) ?? 0,
    total_views: (result?.total_views as number) ?? 0,
  }
}

// 获取文章总数（默认只统计已发布）
export async function getPostsCount(
  db: Database,
  includeDrafts = false,
  includeEncrypted = false,
  includeHidden = false,
  includeDeleted = false,
): Promise<number> {
  await ensureSchema(db)
  const conditions: string[] = []
  if (!includeDrafts) {
    conditions.push("status = 'published'")
  }
  if (!includeDeleted) {
    conditions.push('deleted_at IS NULL')
  }
  if (!includeEncrypted) {
    conditions.push('password IS NULL')
  }
  if (!includeHidden) {
    conditions.push('is_hidden = 0')
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const sql = `SELECT COUNT(*) as count FROM posts ${where}`
  const result = await db.prepare(sql).first<CountRow>()
  return (result?.count as number) ?? 0
}

// 根据分类获取文章数
export async function getPostsCountByCategory(db: Database, category: string): Promise<number> {
  const result = await db
    .prepare(
      `SELECT COUNT(*) as count
       FROM posts
       WHERE category = ?
         AND status = 'published'
         AND password IS NULL
         AND is_hidden = 0
         AND deleted_at IS NULL`,
    )
    .bind(category)
    .first<CountRow>()
  return (result?.count as number) ?? 0
}

// 根据分类获取文章
export async function getPostsByCategory(
  db: Database,
  category: string,
  limit = 50,
  offset = 0,
): Promise<PostWithTags[]> {
  const { results } = await db
    .prepare(
      `SELECT id, slug, title, description, category, tags, status, password, is_pinned, is_hidden, cover_image, deleted_at, published_at, view_count
       FROM posts
       WHERE category = ?
         AND status = 'published'
         AND password IS NULL
         AND is_hidden = 0
         AND deleted_at IS NULL
       ORDER BY is_pinned DESC, published_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(category, limit, offset)
    .all<Post>()

  return results.map(mapPostWithTags)
}

// 恢复已删除的文章（软删除恢复）
export async function restorePost(db: Database, slug: string): Promise<void> {
  await db.prepare("UPDATE posts SET status = 'draft', deleted_at = NULL WHERE slug = ?").bind(slug).run()
}

// 永久删除文章（硬删除）
export async function permanentlyDeletePost(db: Database, slug: string): Promise<void> {
  const post = await db
    .prepare('SELECT category FROM posts WHERE slug = ?')
    .bind(slug)
    .first<PostCategoryRow>()

  await db.prepare('DELETE FROM posts WHERE slug = ?').bind(slug).run()

  if (post?.category) {
    await db
      .prepare('UPDATE categories SET post_count = post_count - 1 WHERE name = ?')
      .bind(post.category)
      .run()
  }
}
