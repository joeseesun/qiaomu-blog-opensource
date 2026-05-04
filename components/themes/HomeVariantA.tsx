'use client'

// Variant A: 精致极简 — evolution of current design
// Better rhythm, date/meta sidebar, category filter pills, subtle hover

import { useState } from 'react'
import Link from 'next/link'
import { SiteHeader } from '@/components/SiteHeader'
import { SiteFooter } from '@/components/SiteFooter'
import { Pagination } from '@/components/Pagination'
import type { HomeProps } from '@/components/HomeClient'

function formatDateShort(ts: number) {
  const d = new Date(ts * 1000)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}.${day}`
}

function formatYear(ts: number) {
  return new Date(ts * 1000).getFullYear()
}

// Category → color mapping (consistent palette)
const CAT_COLORS: Record<string, string> = {
  'AI工具': '#e07b3a',
  'AI教程': '#c0522a',
  '产品': '#7c5cbf',
  '创业': '#2e8fbb',
  '健脑房': '#3da86b',
  '技术': '#d4a017',
  '生活': '#e04a6e',
}
const DEFAULT_CAT_COLOR = '#c96442'

function getCatColor(cat: string | null) {
  if (!cat) return DEFAULT_CAT_COLOR
  return CAT_COLORS[cat] || DEFAULT_CAT_COLOR
}

export function HomeVariantA({
  initialTheme,
  posts,
  categories,
  navLinks,
  currentPage,
  totalPages,
}: HomeProps) {
  const [hoverId, setHoverId] = useState<string | null>(null)

  return (
    <div className="theme-home-refined min-h-full flex flex-col" style={{ background: 'var(--background)' }}>
      <SiteHeader
        initialTheme={initialTheme}
        navLinks={navLinks}
        categories={categories}
      />

      <main className="refined-home-main flex-1 mx-auto w-full" style={{ maxWidth: 860, padding: '0 32px 120px' }}>
        {/* Post list */}
        {posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--stone-gray)', fontSize: 14 }}>
            还没有文章
          </div>
        ) : (
          <>
            <div>
              {posts.map((post, i) => {
                const catColor = getCatColor(post.category)
                const isHovered = hoverId === post.slug
                return (
                  <article
                    key={post.slug}
                    style={{
                      borderTop: `1px solid var(--editor-line)`,
                      marginTop: i === 0 ? 20 : 0,
                    }}
                    onMouseEnter={() => setHoverId(post.slug)}
                    onMouseLeave={() => setHoverId(null)}
                  >
                    <Link
                      href={`/${post.slug}`}
                      className="refined-post-link"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: post.cover_image ? '72px 160px 1fr' : '72px 1fr',
                        gap: 28,
                        padding: '32px 0',
                        textDecoration: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {/* Date sidebar */}
                      <div style={{
                        paddingTop: 5,
                        fontSize: 12,
                        color: 'var(--stone-gray)',
                        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        lineHeight: 1.6,
                        flexShrink: 0,
                      }}>
                        <div>{formatDateShort(post.published_at)}</div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>{formatYear(post.published_at)}</div>
                      </div>

                      {/* Cover image */}
                      {post.cover_image && (
                        <div style={{
                          width: 160,
                          aspectRatio: '4/3',
                          overflow: 'hidden',
                          borderRadius: 4,
                          border: '1px solid var(--editor-line)',
                          background: 'var(--editor-panel)',
                          flexShrink: 0,
                        }}>
                          <img
                            src={post.cover_image}
                            alt={post.title}
                            loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        </div>
                      )}

                      {/* Content */}
                      <div>
                        {post.category && (
                          <div className="refined-post-category" style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            marginBottom: 10,
                          }}>
                            <span style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: catColor,
                              display: 'inline-block',
                            }} />
                            <span style={{
                              fontSize: 12,
                              color: catColor,
                              fontWeight: 500,
                            }}>
                              {post.category}
                            </span>
                            {post.is_pinned === 1 && (
                              <span style={{
                                fontSize: 10,
                                color: 'var(--stone-gray)',
                                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                                letterSpacing: '0.05em',
                              }}>
                                · 置顶
                              </span>
                            )}
                          </div>
                        )}

                        <h2 className="refined-post-title" style={{
                          margin: 0,
                          fontSize: 22,
                          fontWeight: 700,
                          lineHeight: 1.35,
                          letterSpacing: '-0.01em',
                          color: isHovered ? catColor : 'var(--editor-ink)',
                          transition: 'color .25s',
                          fontFamily: 'Georgia, "Noto Serif SC", serif',
                        }}>
                          {post.title}
                          {post.password && (
                            <svg
                              width="15" height="15" viewBox="0 0 24 24"
                              fill="none" stroke="currentColor" strokeWidth="2"
                              strokeLinecap="round" strokeLinejoin="round"
                              style={{ display: 'inline', marginLeft: 8, verticalAlign: 'middle', color: 'var(--stone-gray)' }}
                            >
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                          )}
                        </h2>

                        {post.description && (
                          <p style={{
                            margin: '10px 0 0',
                            fontSize: 14,
                            lineHeight: 1.75,
                            color: 'var(--editor-muted)',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}>
                            {post.description}
                          </p>
                        )}

                        <div style={{
                          marginTop: 12,
                          fontSize: 12,
                          color: 'var(--stone-gray)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}>
                          <span>阅读全文</span>
                          <span style={{
                            display: 'inline-block',
                            transition: 'transform .25s',
                            transform: isHovered ? 'translateX(5px)' : 'translateX(0)',
                          }}>→</span>
                        </div>
                      </div>
                    </Link>
                  </article>
                )
              })}
            </div>

            <div style={{ paddingTop: 16 }}>
              <Pagination currentPage={currentPage} totalPages={totalPages} basePath="/" />
            </div>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  )
}
