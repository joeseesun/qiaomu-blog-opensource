'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X } from 'lucide-react'

interface ImageLightboxProps {
  src: string
  alt?: string
  onClose: () => void
}

/**
 * 全屏图片预览 lightbox：通过 portal 挂到 body，避免被父级 overflow 裁切。
 * Esc 关闭 / 点击遮罩关闭 / 右上角 X 按钮关闭。
 */
export function ImageLightbox({ src, alt = '图片预览', onClose }: ImageLightboxProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    // 锁滚动
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/25"
        title="关闭（Esc）"
        aria-label="关闭预览"
      >
        <X className="h-5 w-5" />
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] object-contain shadow-2xl"
        onClick={e => e.stopPropagation()}
      />

      <div
        className="mt-4 flex max-w-[90vw] items-center gap-3 rounded-full bg-black/50 px-4 py-2 text-xs text-white/90"
        onClick={e => e.stopPropagation()}
      >
        <span className="truncate" title={src}>{src}</span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-white transition hover:bg-white/25"
        >
          <ExternalLink className="h-3 w-3" />
          新标签页打开
        </a>
      </div>
    </div>,
    document.body,
  )
}
