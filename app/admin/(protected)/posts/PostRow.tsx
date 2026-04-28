'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Eye, Link2, Edit, Pin, PinOff, EyeOff, Eye as EyeIcon, Lock, Unlock, Check, FileText, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { Modal } from '@/components/Modal'
import { PasswordModal } from '@/components/PasswordModal'
import { Dropdown } from '@/components/Dropdown'
import type { PostWithTags } from '@/lib/db'
import { getSiteUrl } from '@/lib/site-config'

interface PostRowProps {
  post: PostWithTags
  categories: string[]
}

function formatDate(ts: number) {
  const date = new Date(ts * 1000)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays < 7) return `${diffDays}天前`

  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}

export function PostRow({ post, categories }: PostRowProps) {
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showPermanentModal, setShowPermanentModal] = useState(false)
  const [showPinModal, setShowPinModal] = useState(false)
  const [showHiddenModal, setShowHiddenModal] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [loading, setLoading] = useState(false)

  const router = useRouter()
  const toast = useToast()

  const siteUrl = getSiteUrl()
  const baseArticleUrl = `${siteUrl}/${post.slug}`
  const articleUrl = post.password
    ? `${baseArticleUrl}?pwd=${post.password}`
    : baseArticleUrl

  const isDeleted = post.status === 'deleted'

  // 分类选项
  const categoryOptions = [
    { value: '', label: '未分类' },
    ...categories.map((cat) => ({ value: cat, label: cat })),
  ]

  // 查看文章
  const handleView = () => {
    window.open(articleUrl, '_blank')
  }

  // 复制链接
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(articleUrl)
      toast.success(post.password ? '已复制带密码的链接' : '已复制链接')
    } catch {
      toast.error('复制失败')
    }
  }

  // 更新分类
  const handleCategoryChange = async (newCategory: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/posts/${post.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: newCategory || null }),
      })
      if (res.ok) {
        toast.success('分类已更新')
        router.refresh()
      } else {
        toast.error('更新失败')
      }
    } catch {
      toast.error('网络错误')
    } finally {
      setLoading(false)
    }
  }

  // 置顶切换
  const handlePinToggle = async () => {
    setLoading(true)
    const newPinned = post.is_pinned === 1 ? 0 : 1
    try {
      const res = await fetch(`/api/admin/posts/${post.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_pinned: newPinned }),
      })
      if (res.ok) {
        toast.success(newPinned === 1 ? '已置顶' : '已取消置顶')
        setShowPinModal(false)
        router.refresh()
        return true
      } else {
        toast.error('操作失败')
        return false
      }
    } catch {
      toast.error('网络错误')
      return false
    } finally {
      setLoading(false)
    }
  }

  // 隐藏切换
  const handleHiddenToggle = async () => {
    setLoading(true)
    const newHidden = post.is_hidden === 1 ? 0 : 1
    try {
      const res = await fetch(`/api/admin/posts/${post.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_hidden: newHidden }),
      })
      if (res.ok) {
        toast.success(newHidden === 1 ? '已隐藏' : '已取消隐藏')
        setShowHiddenModal(false)
        router.refresh()
        return true
      } else {
        toast.error('操作失败')
        return false
      }
    } catch {
      toast.error('网络错误')
      return false
    } finally {
      setLoading(false)
    }
  }

  // 状态切换
  const handleStatusToggle = async () => {
    setLoading(true)
    const newStatus = post.status === 'published' ? 'draft' : 'published'
    try {
      const res = await fetch(`/api/admin/posts/${post.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        toast.success(newStatus === 'published' ? '已发布' : '已转为草稿')
        setShowStatusModal(false)
        router.refresh()
        return true
      } else {
        toast.error('操作失败')
        return false
      }
    } catch {
      toast.error('网络错误')
      return false
    } finally {
      setLoading(false)
    }
  }

  // 软删除
  const handleSoftDelete = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/posts/${post.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'deleted' }),
      })
      if (res.ok) {
        toast.success('已删除（可恢复）')
        setShowDeleteModal(false)
        router.refresh()
        return true
      } else {
        toast.error('删除失败')
        return false
      }
    } catch {
      toast.error('网络错误')
      return false
    } finally {
      setLoading(false)
    }
  }

  // 恢复
  const handleRestore = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/posts/${post.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      })
      if (res.ok) {
        toast.success('已恢复为草稿')
        router.refresh()
      } else {
        toast.error('恢复失败')
      }
    } catch {
      toast.error('网络错误')
    } finally {
      setLoading(false)
    }
  }

  // 永久删除
  const handlePermanentDelete = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/posts/${post.slug}`, { method: 'DELETE' })

      let data: { success?: boolean; error?: string }
      try {
        data = (await res.json()) as { success?: boolean; error?: string }
      } catch {
        toast.error(`删除失败: HTTP ${res.status}`)
        return false
      }

      if (res.ok && data.success) {
        toast.success('已永久删除')
        setShowPermanentModal(false)
        router.refresh()
        return true
      } else {
        toast.error(data.error || `删除失败 (${res.status})`)
        return false
      }
    } catch (err) {
      console.error('Delete error:', err)
      toast.error(`网络错误: ${err instanceof Error ? err.message : '未知'}`)
      return false
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* 桌面端 */}
      <div className="hidden md:grid grid-cols-[50px_1fr_120px_90px_260px] gap-3 px-5 py-3 hover:bg-[var(--editor-panel)] transition-colors items-center">
        {/* 状态列 */}
        <div className="flex flex-col items-center gap-1.5">
          {/* 状态圆点 */}
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              post.status === 'published'
                ? 'bg-emerald-500'
                : post.status === 'deleted'
                ? 'bg-gray-400'
                : 'bg-amber-500'
            }`}
            title={post.status === 'published' ? '已发布' : post.status === 'deleted' ? '已删除' : '草稿'}
          />
          {/* 图标行 */}
          <div className="flex items-center gap-1">
            {post.is_pinned === 1 && (
              <Pin className="w-3 h-3 text-[var(--editor-accent)]" />
            )}
            {post.password && (
              <Lock className="w-3 h-3 text-[var(--stone-gray)]" />
            )}
            {post.is_hidden === 1 && (
              <EyeOff className="w-3 h-3 text-[var(--stone-gray)]" />
            )}
          </div>
        </div>

        {/* 标题列 */}
        <div className="min-w-0">
          <Link
            href={`/editor?edit=${post.slug}`}
            className="font-medium text-[var(--editor-ink)] hover:text-[var(--editor-accent)] transition-colors line-clamp-1 block"
          >
            {post.title}
          </Link>
          {post.description && (
            <p className="text-xs text-[var(--editor-muted)] line-clamp-1 leading-relaxed mt-0.5">
              {post.description}
            </p>
          )}
        </div>

        {/* 分类列 */}
        <div className="flex items-center">
          <Dropdown
            options={categoryOptions}
            value={post.category || ''}
            onChange={handleCategoryChange}
            placeholder="未分类"
            className="w-full"
            disabled={loading || isDeleted}
          />
        </div>

        {/* 阅读/日期列 */}
        <div className="flex flex-col items-center justify-center text-xs">
          <span className="text-[var(--editor-ink)] font-medium tabular-nums">
            {post.view_count.toLocaleString()}
          </span>
          <span className="text-[var(--stone-gray)] text-[11px]">
            {formatDate(post.published_at)}
          </span>
        </div>

        {/* 操作列 */}
        <div className="flex flex-wrap items-center justify-end gap-1 min-w-0">
          {isDeleted ? (
            <>
              <button
                onClick={handleRestore}
                disabled={loading}
                className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors disabled:opacity-50"
                title="恢复为草稿"
                aria-label="恢复为草稿"
              >
                <Check className="w-4 h-4 text-emerald-600" />
              </button>
              <button
                onClick={() => setShowPermanentModal(true)}
                disabled={loading}
                className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors disabled:opacity-50"
                title="永久删除"
                aria-label="永久删除"
              >
                <Trash2 className="w-4 h-4 text-rose-500" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleView}
                className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors"
                title="查看文章"
                aria-label="查看文章"
              >
                <Eye className="w-4 h-4 text-[var(--stone-gray)]" />
              </button>
              <button
                onClick={handleCopyLink}
                className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors"
                title="复制链接"
                aria-label="复制链接"
              >
                <Link2 className="w-4 h-4 text-[var(--stone-gray)]" />
              </button>
              <Link
                href={`/editor?edit=${post.slug}`}
                className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors"
                title="编辑文章"
                aria-label="编辑文章"
              >
                <Edit className="w-4 h-4 text-[var(--stone-gray)]" />
              </Link>
              <button
                onClick={() => setShowPinModal(true)}
                disabled={loading}
                className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors disabled:opacity-50"
                title={post.is_pinned === 1 ? '取消置顶' : '置顶文章'}
                aria-label={post.is_pinned === 1 ? '取消置顶' : '置顶文章'}
              >
                {post.is_pinned === 1 ? (
                  <PinOff className="w-4 h-4 text-[var(--editor-accent)]" />
                ) : (
                  <Pin className="w-4 h-4 text-[var(--stone-gray)]" />
                )}
              </button>
              <button
                onClick={() => setShowHiddenModal(true)}
                disabled={loading}
                className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors disabled:opacity-50"
                title={post.is_hidden === 1 ? '取消隐藏' : '隐藏文章'}
                aria-label={post.is_hidden === 1 ? '取消隐藏' : '隐藏文章'}
              >
                {post.is_hidden === 1 ? (
                  <EyeOff className="w-4 h-4 text-[var(--stone-gray)]" />
                ) : (
                  <EyeIcon className="w-4 h-4 text-[var(--stone-gray)]" />
                )}
              </button>
              <button
                onClick={() => setShowPasswordModal(true)}
                className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors"
                title={post.password ? '管理访问密码' : '设置访问密码'}
                aria-label={post.password ? '管理访问密码' : '设置访问密码'}
              >
                {post.password ? (
                  <Lock className="w-4 h-4 text-[var(--editor-accent)]" />
                ) : (
                  <Unlock className="w-4 h-4 text-[var(--stone-gray)]" />
                )}
              </button>
              <button
                onClick={() => setShowStatusModal(true)}
                disabled={loading}
                className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors disabled:opacity-50"
                title={post.status === 'published' ? '转为草稿' : '发布文章'}
                aria-label={post.status === 'published' ? '转为草稿' : '发布文章'}
              >
                {post.status === 'published' ? (
                  <FileText className="w-4 h-4 text-amber-500" />
                ) : (
                  <Check className="w-4 h-4 text-emerald-600" />
                )}
              </button>
              <button
                onClick={() => setShowDeleteModal(true)}
                disabled={loading}
                className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors disabled:opacity-50"
                title="删除文章"
                aria-label="删除文章"
              >
                <Trash2 className="w-4 h-4 text-rose-500" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 移动端 */}
      <div className="md:hidden p-4 hover:bg-[var(--editor-panel)] transition-colors">
        <div className="flex items-start gap-3 mb-2">
          {/* 状态列 */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                post.status === 'published'
                  ? 'bg-emerald-500'
                  : post.status === 'deleted'
                  ? 'bg-gray-400'
                  : 'bg-amber-500'
              }`}
            />
            <div className="flex flex-col gap-0.5">
              {post.is_pinned === 1 && <Pin className="w-3 h-3 text-[var(--editor-accent)]" />}
              {post.password && <Lock className="w-3 h-3 text-[var(--stone-gray)]" />}
              {post.is_hidden === 1 && <EyeOff className="w-3 h-3 text-[var(--stone-gray)]" />}
            </div>
          </div>

          {/* 标题 */}
          <Link
            href={`/editor?edit=${post.slug}`}
            className="font-medium text-[var(--editor-ink)] hover:text-[var(--editor-accent)] transition-colors flex-1 line-clamp-2"
          >
            {post.title}
          </Link>
        </div>

        {post.description && (
          <p className="text-xs text-[var(--editor-muted)] line-clamp-2 leading-relaxed mb-3 ml-9">
            {post.description}
          </p>
        )}

        <div className="flex items-center gap-2 text-xs text-[var(--stone-gray)] mb-3 ml-9">
          <div className="w-24">
            <Dropdown
              options={categoryOptions}
              value={post.category || ''}
              onChange={handleCategoryChange}
              placeholder="未分类"
              className="w-full"
              disabled={loading || isDeleted}
            />
          </div>
          <span>·</span>
          <span className="tabular-nums">{post.view_count.toLocaleString()} 次</span>
          <span>·</span>
          <span>{formatDate(post.published_at)}</span>
        </div>

        <div className="flex items-center gap-2 ml-9 flex-wrap">
          {isDeleted ? (
            <>
              <button
                onClick={handleRestore}
                disabled={loading}
                className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors disabled:opacity-50"
                title="恢复为草稿"
                aria-label="恢复为草稿"
              >
                <Check className="w-4 h-4 text-emerald-600" />
              </button>
              <button
                onClick={() => setShowPermanentModal(true)}
                disabled={loading}
                className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors disabled:opacity-50"
                title="永久删除"
                aria-label="永久删除"
              >
                <Trash2 className="w-4 h-4 text-rose-500" />
              </button>
            </>
          ) : (
            <>
              <button onClick={handleView} className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors" title="查看文章" aria-label="查看文章">
                <Eye className="w-4 h-4 text-[var(--stone-gray)]" />
              </button>
              <button onClick={handleCopyLink} className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors" title="复制链接" aria-label="复制链接">
                <Link2 className="w-4 h-4 text-[var(--stone-gray)]" />
              </button>
              <Link href={`/editor?edit=${post.slug}`} className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors" title="编辑文章" aria-label="编辑文章">
                <Edit className="w-4 h-4 text-[var(--stone-gray)]" />
              </Link>
              <button onClick={() => setShowPinModal(true)} disabled={loading} className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors disabled:opacity-50" title={post.is_pinned === 1 ? '取消置顶' : '置顶文章'} aria-label={post.is_pinned === 1 ? '取消置顶' : '置顶文章'}>
                {post.is_pinned === 1 ? <PinOff className="w-4 h-4 text-[var(--editor-accent)]" /> : <Pin className="w-4 h-4 text-[var(--stone-gray)]" />}
              </button>
              <button onClick={() => setShowHiddenModal(true)} disabled={loading} className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors disabled:opacity-50" title={post.is_hidden === 1 ? '取消隐藏' : '隐藏文章'} aria-label={post.is_hidden === 1 ? '取消隐藏' : '隐藏文章'}>
                {post.is_hidden === 1 ? <EyeOff className="w-4 h-4 text-[var(--stone-gray)]" /> : <EyeIcon className="w-4 h-4 text-[var(--stone-gray)]" />}
              </button>
              <button onClick={() => setShowPasswordModal(true)} className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors" title={post.password ? '管理访问密码' : '设置访问密码'} aria-label={post.password ? '管理访问密码' : '设置访问密码'}>
                {post.password ? <Lock className="w-4 h-4 text-[var(--editor-accent)]" /> : <Unlock className="w-4 h-4 text-[var(--stone-gray)]" />}
              </button>
              <button onClick={() => setShowStatusModal(true)} disabled={loading} className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors disabled:opacity-50" title={post.status === 'published' ? '转为草稿' : '发布文章'} aria-label={post.status === 'published' ? '转为草稿' : '发布文章'}>
                {post.status === 'published' ? <FileText className="w-4 h-4 text-amber-500" /> : <Check className="w-4 h-4 text-emerald-600" />}
              </button>
              <button onClick={() => setShowDeleteModal(true)} disabled={loading} className="p-1.5 rounded hover:bg-[var(--editor-soft)] transition-colors disabled:opacity-50" title="删除文章" aria-label="删除文章">
                <Trash2 className="w-4 h-4 text-rose-500" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      <PasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        slug={post.slug}
        currentPassword={post.password}
        articleUrl={baseArticleUrl}
        onSuccess={() => {
          window.location.reload()
        }}
      />

      <Modal
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onConfirm={handlePinToggle}
        title={post.is_pinned === 1 ? '取消置顶' : '置顶文章'}
        description={post.is_pinned === 1 ? '确定要取消置顶吗？' : '置顶后文章将显示在列表顶部。'}
        confirmText="确认"
        type="info"
      />

      <Modal
        isOpen={showHiddenModal}
        onClose={() => setShowHiddenModal(false)}
        onConfirm={handleHiddenToggle}
        title={post.is_hidden === 1 ? '取消隐藏' : '隐藏文章'}
        description={
          post.is_hidden === 1
            ? '取消隐藏后，文章将重新出现在首页、RSS 和搜索结果中。'
            : '隐藏后，文章不会在首页、RSS 和搜索中显示，但可以通过直接链接访问。'
        }
        confirmText="确认"
        type="info"
      />

      <Modal
        isOpen={showStatusModal}
        onClose={() => setShowStatusModal(false)}
        onConfirm={handleStatusToggle}
        title={post.status === 'published' ? '转为草稿' : '发布文章'}
        description={
          post.status === 'published'
            ? '转为草稿后，文章将不再公开显示。'
            : '发布后，文章将在首页和 RSS 中显示。'
        }
        confirmText="确认"
        type="info"
      />

      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleSoftDelete}
        title="删除文章"
        description={`确定要删除「${post.title}」吗？删除后可以在已删除列表中恢复。`}
        confirmText="删除"
        type="warning"
      />

      <Modal
        isOpen={showPermanentModal}
        onClose={() => setShowPermanentModal(false)}
        onConfirm={handlePermanentDelete}
        title="永久删除"
        description={`确定要永久删除「${post.title}」吗？此操作不可恢复！`}
        confirmText="永久删除"
        type="danger"
      />
    </>
  )
}
