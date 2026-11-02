'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import type { ExternalPublishTarget, PublishArticle } from '@/lib/external-publish'

const ExternalPublishModal = dynamic(() => import('./ExternalPublishModal').then(module => module.ExternalPublishModal), { ssr: false })

export function PublishChannelMenu({ onWechat, getArticle, buttonClassName, iconClassName }: { onWechat: () => void; getArticle: () => PublishArticle; buttonClassName: string; iconClassName: string }) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<ExternalPublishTarget | null>(null)
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return <span ref={root} className="relative inline-flex" onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus() } }}>
    <button ref={trigger} type="button" onClick={() => setOpen(!open)} className={buttonClassName} title="发送到平台草稿" aria-label="发送到平台草稿" aria-expanded={open}><Send className={iconClassName} /></button>
    {open && <span className="absolute right-0 top-full z-50 mt-2 flex w-40 flex-col rounded-lg border border-[var(--editor-line)] bg-[var(--editor-panel)] p-1 text-sm text-[var(--editor-ink)] shadow-lg">
      <button type="button" className="rounded px-3 py-2 text-left hover:bg-[var(--editor-soft)]" onClick={() => { setOpen(false); onWechat() }}>公众号草稿</button>
      {(['x', 'zhihu'] as const).map(id => <button key={id} type="button" className="rounded px-3 py-2 text-left hover:bg-[var(--editor-soft)]" onClick={() => { setOpen(false); setTarget(id) }}>{id === 'x' ? 'X 文章草稿' : '知乎草稿'}</button>)}
    </span>}
    {target && <ExternalPublishModal target={target} getArticle={getArticle} onClose={() => { setTarget(null); trigger.current?.focus() }} />}
  </span>
}
