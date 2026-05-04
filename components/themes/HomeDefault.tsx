'use client'

import Link from 'next/link'
import { SiteHeader } from '@/components/SiteHeader'
import { SiteFooter } from '@/components/SiteFooter'
import { Pagination } from '@/components/Pagination'
import type { HomeProps } from '@/components/HomeClient'

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function HomeDefault({
  initialTheme,
  posts,
  categories,
  navLinks,
  currentPage,
  totalPages,
  categorySlugMap,
}: HomeProps) {
  return (
    <div className="min-h-full flex flex-col bg-[var(--background)]">
      <SiteHeader
        initialTheme={initialTheme}
        navLinks={navLinks}
        categories={categories}
      />
      <main className="flex-1 mx-auto max-w-3xl w-full px-4 sm:px-6 py-10 sm:py-14">
        {posts.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[var(--editor-muted)] mb-3">还没有文章</p>
            <p className="text-sm text-[var(--stone-gray)]">开始写作，记录思考</p>
          </div>
        ) : (
          <>
            <div className="space-y-0">
              {posts.map((post, index) => (
                <article
                  key={post.slug}
                  className="group border-t border-[var(--editor-line)] first:border-t-0"
                  style={{ animation: `fadeInUp 0.4s ease-out ${index * 0.05}s both` }}
                >
                  <Link
                    href={`/${post.slug}`}
                    className="block py-6 sm:py-7 transition-all duration-200 hover:bg-[var(--editor-panel)] border-l-2 border-l-transparent hover:border-l-[var(--editor-accent)] pl-4"
                  >
                    <div className={post.cover_image ? 'flex gap-4 items-start' : ''}>
                      {post.cover_image && (
                        <div className="flex-shrink-0 w-32 sm:w-40 aspect-[4/3] overflow-hidden rounded border border-[var(--editor-line)] bg-[var(--editor-panel)]">
                          <img
                            src={post.cover_image}
                            alt={post.title}
                            loading="lazy"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                      <h2
                        className="text-xl sm:text-2xl font-bold text-[var(--editor-ink)] leading-snug mb-2 group-hover:text-[var(--editor-accent)] transition-colors duration-200 flex items-center gap-2"
                        style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}
                      >
                        {post.title}
                        {post.password && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--editor-muted)] flex-shrink-0">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                          </svg>
                        )}
                        {post.is_pinned === 1 && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--editor-accent)] flex-shrink-0">
                            <line x1="12" y1="17" x2="12" y2="22"></line>
                            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
                          </svg>
                        )}
                      </h2>
                      {post.description && (
                        <p className="text-sm text-[var(--editor-muted)] leading-relaxed line-clamp-2 mb-2.5">
                          {post.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 text-xs text-[var(--stone-gray)]">
                        <time>{formatDate(post.published_at)}</time>
                        {post.category && (
                          <>
                            <span aria-hidden>·</span>
                            {(() => {
                              const slug = categorySlugMap[post.category]
                              return slug ? (
                                <Link
                                  href={`/category/${slug}`}
                                  className="px-2 py-0.5 rounded-full bg-[var(--editor-accent)]/8 text-[var(--editor-accent)] font-medium border border-[var(--editor-accent)]/15 hover:bg-[var(--editor-accent)]/12 transition-colors"
                                >
                                  {post.category}
                                </Link>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-[var(--editor-accent)]/8 text-[var(--editor-accent)] font-medium border border-[var(--editor-accent)]/15">
                                  {post.category}
                                </span>
                              )
                            })()}
                          </>
                        )}
                      </div>
                      </div>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
            <Pagination currentPage={currentPage} totalPages={totalPages} basePath="/" />
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  )
}
