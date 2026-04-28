'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Dropdown } from '@/components/Dropdown'

interface FilterBarProps {
  currentStatus?: string
  currentCategory?: string
  categories: string[]
  initialQuery?: string
  counts: {
    all: number
    published: number
    draft: number
    deleted: number
    encrypted: number
    unlisted: number
    pinned: number
  }
  resultCount: number
}

export function FilterBar({
  currentStatus,
  currentCategory,
  categories,
  initialQuery = '',
  counts,
  resultCount,
}: FilterBarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(initialQuery)

  useEffect(() => {
    setQuery(initialQuery)
  }, [initialQuery])

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') {
      params.delete(key)
    } else {
      params.set(key, value)
    }
    const qs = params.toString()
    router.push(`/admin/posts${qs ? `?${qs}` : ''}`)
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = query.trim()
    const params = new URLSearchParams(searchParams.toString())
    if (trimmed) {
      params.set('q', trimmed)
    } else {
      params.delete('q')
    }
    const qs = params.toString()
    router.push(`/admin/posts${qs ? `?${qs}` : ''}`)
  }

  const handleClear = () => {
    setQuery('')
    const params = new URLSearchParams(searchParams.toString())
    params.delete('q')
    const qs = params.toString()
    router.push(`/admin/posts${qs ? `?${qs}` : ''}`)
  }

  const activeStatus = currentStatus || 'all'
  const activeCategory = currentCategory || 'all'
  const hasActiveFilters = Boolean(query.trim() || activeStatus !== 'all' || activeCategory !== 'all')

  const categoryOptions = [
    { value: 'all', label: '全部分类' },
    ...categories.map((cat) => ({ value: cat, label: cat })),
  ]

  const statusItems = [
    { value: 'all', label: '全部', count: counts.all },
    { value: 'published', label: '已发布', count: counts.published },
    { value: 'draft', label: '草稿', count: counts.draft },
    { value: 'deleted', label: '已删除', count: counts.deleted },
    { value: 'encrypted', label: '加密', count: counts.encrypted },
    { value: 'unlisted', label: '隐藏', count: counts.unlisted },
    { value: 'pinned', label: '置顶', count: counts.pinned },
  ] as const

  return (
    <div className="mb-5 rounded-xl border border-[var(--editor-line)] bg-[var(--editor-panel)] p-4 sm:p-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <form onSubmit={handleSearch} className="flex-1">
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题、摘要或正文…"
                className="w-full rounded-lg border border-[var(--editor-line)] bg-[var(--background)] px-3 py-2 pl-9 pr-9 text-sm text-[var(--editor-ink)] placeholder:text-[var(--editor-muted)] transition-all focus:border-[var(--editor-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--editor-accent)]/20"
              />
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--stone-gray)]"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              {query && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--stone-gray)] transition-colors hover:text-[var(--editor-ink)]"
                  title="清除搜索"
                  aria-label="清除搜索"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              )}
            </div>
          </form>

          <div className="flex items-center gap-3">
            <div className="min-w-[160px]">
              <Dropdown
                options={categoryOptions}
                value={activeCategory}
                onChange={(value) => updateFilter('category', value)}
                placeholder="全部分类"
                className="w-full"
              />
            </div>

            {hasActiveFilters ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  router.push('/admin/posts')
                }}
                className="shrink-0 rounded-lg border border-[var(--editor-line)] px-3 py-2 text-sm text-[var(--editor-muted)] transition hover:bg-[var(--editor-soft)] hover:text-[var(--editor-ink)]"
              >
                清空筛选
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {statusItems.map((item) => (
              <button
                key={item.value}
                onClick={() => updateFilter('status', item.value)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  activeStatus === item.value
                    ? 'bg-[var(--editor-accent)] text-white font-medium'
                    : 'bg-[var(--editor-panel)] text-[var(--editor-muted)] hover:bg-[var(--editor-soft)] hover:text-[var(--editor-ink)]'
                }`}
              >
                <span>{item.label}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                  activeStatus === item.value ? 'bg-white/15 text-white' : 'bg-[var(--background)] text-[var(--editor-muted)]'
                }`}>
                  {item.count}
                </span>
              </button>
            ))}
          </div>

          <div className="text-xs text-[var(--stone-gray)]">
            当前结果 {resultCount} 篇
          </div>
        </div>
      </div>
    </div>
  )
}
