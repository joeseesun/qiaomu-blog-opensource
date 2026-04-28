'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { Modal } from '@/components/Modal'

interface PinToggleProps {
  slug: string
  isPinned: number
}

export function PinToggle({ slug, isPinned }: PinToggleProps) {
  const [pinned, setPinned] = useState(isPinned)
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const router = useRouter()
  const toast = useToast()

  const newPinned = pinned === 1 ? 0 : 1

  const handleToggle = async () => {
    setLoading(true)

    try {
      const response = await fetch(`/api/admin/posts/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_pinned: newPinned }),
      })

      if (!response.ok) {
        throw new Error('置顶状态更新失败')
      }

      setPinned(newPinned)
      toast.success(newPinned === 1 ? '文章已置顶' : '已取消置顶')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '置顶状态更新失败')
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
          pinned === 1
            ? 'text-[var(--editor-accent)] hover:bg-[var(--editor-accent)]/10'
            : 'text-[var(--stone-gray)] hover:bg-[var(--editor-soft)]'
        }`}
        title={pinned === 1 ? '取消置顶' : '置顶文章'}
        aria-label={pinned === 1 ? '取消置顶' : '置顶文章'}
      >
        {loading ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill={pinned === 1 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="17" x2="12" y2="22"></line>
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
          </svg>
        )}
      </button>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleToggle}
        title={newPinned === 1 ? '置顶文章' : '取消置顶'}
        description={newPinned === 1 ? '确定要置顶这篇文章吗？' : '确定要取消置顶吗？'}
        confirmText="确认"
        type="info"
      />
    </>
  )
}
