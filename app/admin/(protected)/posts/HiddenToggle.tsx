'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { Modal } from '@/components/Modal'
import { EyeOff, Eye } from 'lucide-react'

interface HiddenToggleProps {
  slug: string
  isHidden: number
}

export function HiddenToggle({ slug, isHidden }: HiddenToggleProps) {
  const [hidden, setHidden] = useState(isHidden)
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const router = useRouter()
  const toast = useToast()

  const newHidden = hidden === 1 ? 0 : 1

  const handleToggle = async () => {
    setLoading(true)

    try {
      const response = await fetch(`/api/admin/posts/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_hidden: newHidden }),
      })

      if (!response.ok) {
        throw new Error('隐藏状态更新失败')
      }

      setHidden(newHidden)
      toast.success(newHidden === 1 ? '文章已隐藏' : '已取消隐藏')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '隐藏状态更新失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        disabled={loading}
        className={`p-1.5 rounded transition-colors disabled:opacity-50 ${
          hidden === 1
            ? 'text-[var(--stone-gray)] hover:bg-[var(--editor-soft)]'
            : 'text-[var(--stone-gray)] hover:bg-[var(--editor-soft)]'
        }`}
        title={hidden === 1 ? '取消隐藏' : '隐藏文章'}
        aria-label={hidden === 1 ? '取消隐藏' : '隐藏文章'}
      >
        {loading ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : hidden === 1 ? (
          <EyeOff className="w-4 h-4" />
        ) : (
          <Eye className="w-4 h-4" />
        )}
      </button>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleToggle}
        title={newHidden === 1 ? '隐藏文章' : '取消隐藏'}
        description={
          newHidden === 1
            ? '隐藏后，文章不会在首页、RSS 和搜索中显示，但可以通过直接链接访问。'
            : '取消隐藏后，文章将重新出现在首页、RSS 和搜索结果中。'
        }
        confirmText="确认"
        type="info"
      />
    </>
  )
}
