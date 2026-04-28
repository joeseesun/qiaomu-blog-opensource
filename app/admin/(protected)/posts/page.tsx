import { getPosts, searchPosts, getCategories } from '@/lib/db'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import Link from 'next/link'
import { PostRow } from './PostRow'
import { FilterBar } from './FilterBar'

export const metadata = { title: '文章管理' }

export default async function AdminPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; category?: string }>
}) {
  const params = await searchParams
  const { q, status, category } = params

  const env = await getAppCloudflareEnv()
  let sourcePosts: Awaited<ReturnType<typeof getPosts>> = []

  if (env?.DB) {
    try {
      if (q && q.trim()) {
        sourcePosts = await searchPosts(env.DB, q.trim(), 200, true, true, true, true) // includeDrafts, includeEncrypted, includeHidden, includeDeleted
      } else {
        sourcePosts = await getPosts(env.DB, 200, 0, true, true, true, true) // includeDrafts, includeEncrypted, includeHidden, includeDeleted
      }
    } catch (error) {
      console.error('Posts fetch error:', error)
    }
  }

  // 从 categories 表获取正式分类列表（用于 PostRow 下拉菜单）
  let dbCategories: string[] = []
  if (env?.DB) {
    try {
      const cats = await getCategories(env.DB)
      dbCategories = cats.map(c => c.name).filter(n => n !== '未分类')
    } catch {}
  }

  // 从文章数据提取分类（用于 FilterBar 筛选）
  const postCategories = Array.from(
    new Set(sourcePosts.map((p) => p.category).filter(Boolean))
  ) as string[]

  const stats = {
    all: sourcePosts.length,
    published: sourcePosts.filter((p) => p.status === 'published').length,
    draft: sourcePosts.filter((p) => p.status === 'draft').length,
    deleted: sourcePosts.filter((p) => p.status === 'deleted').length,
    encrypted: sourcePosts.filter((p) => !!p.password).length,
    unlisted: sourcePosts.filter((p) => p.is_hidden === 1).length,
    pinned: sourcePosts.filter((p) => p.is_pinned === 1).length,
  }

  let posts = sourcePosts
  if (status && status !== 'all') {
    switch (status) {
      case 'encrypted':
        posts = posts.filter((p) => !!p.password)
        break
      case 'unlisted':
        posts = posts.filter((p) => p.is_hidden === 1)
        break
      case 'pinned':
        posts = posts.filter((p) => p.is_pinned === 1)
        break
      default:
        posts = posts.filter((p) => p.status === status)
    }
  }
  if (category && category !== 'all') {
    posts = posts.filter((p) => p.category === category)
  }

  return (
    <div>
      <FilterBar
        currentStatus={status}
        currentCategory={category}
        categories={postCategories}
        initialQuery={q}
        counts={stats}
        resultCount={posts.length}
      />

      {posts.length === 0 ? (
        <div className="bg-[var(--editor-panel)] rounded-xl border border-[var(--editor-line)] p-20 text-center">
          <div className="max-w-xs mx-auto">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--editor-soft)] flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--stone-gray)]">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="12" y1="18" x2="12" y2="12"></line>
                <line x1="9" y1="15" x2="15" y2="15"></line>
              </svg>
            </div>
            <p className="text-[var(--editor-muted)] mb-2">
              {q ? '未找到匹配的文章' : '还没有任何文章'}
            </p>
            <p className="text-xs text-[var(--stone-gray)] mb-4">
              {q ? '试试其他关键词' : '开始创作，分享你的思考'}
            </p>
            {!q && (
              <Link
                href="/editor"
                className="inline-flex items-center gap-1.5 text-sm text-[var(--editor-accent)] hover:underline underline-offset-2 font-medium"
              >
                写第一篇文章 →
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-[var(--editor-panel)] rounded-xl border border-[var(--editor-line)] overflow-hidden">
          {/* 表头 */}
          <div className="hidden md:grid grid-cols-[50px_1fr_120px_90px_260px] gap-3 px-5 py-3.5 border-b border-[var(--editor-line)] bg-[var(--editor-soft)]">
            <span className="text-xs font-semibold text-[var(--editor-muted)] uppercase tracking-wide text-center">
              状态
            </span>
            <span className="text-xs font-semibold text-[var(--editor-muted)] uppercase tracking-wide">
              标题
            </span>
            <span className="text-xs font-semibold text-[var(--editor-muted)] uppercase tracking-wide">
              分类
            </span>
            <span className="text-xs font-semibold text-[var(--editor-muted)] uppercase tracking-wide text-center">
              阅读
            </span>
            <span className="text-xs font-semibold text-[var(--editor-muted)] uppercase tracking-wide text-right">
              操作
            </span>
          </div>

          {/* 文章列表 */}
          <div className="divide-y divide-[var(--editor-line)]">
            {posts.map((post) => (
              <PostRow key={post.slug} post={post} categories={dbCategories} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
