'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { requestPublishExtension, draftUrl, prepareExternalArticle, type ExternalPublishTarget, type PublishArticle, type PublishProgress } from '@/lib/external-publish'

export function ExternalPublishModal({ target, getArticle, onClose }: { target: ExternalPublishTarget; getArticle: () => PublishArticle; onClose: () => void }) {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const abort = useRef<AbortController | null>(null)
  const active = useRef(false)
  const [status, setStatus] = useState<PublishProgress | null>(null)
  const [converted, setConverted] = useState(false)
  const [videoNote, setVideoNote] = useState('')
  const busy = status?.state === 'running'
  const label = target === 'x' ? 'X 文章' : '知乎'
  useEffect(() => {
    dialog.current?.showModal()
    return () => { abort.current?.abort(); if (active.current) void requestPublishExtension('cancel').catch(() => {}) }
  }, [])
  const send = async () => {
    const controller = new AbortController(); abort.current = controller
    setConverted(false)
    setVideoNote('')
    setStatus({ state: 'running', text: '正在连接浏览器…' })
    try {
      await requestPublishExtension('ping', undefined, controller.signal)
      setStatus({ state: 'running', text: '正在准备正文、图片和视频…' })
      const payload = await prepareExternalArticle(target, getArticle(), controller.signal, text => { if (!controller.signal.aborted) setStatus({ state: 'running', text }) })
      if (controller.signal.aborted) return
      setConverted(payload.convertedEmbeds > 0)
      setVideoNote([payload.videoCount ? `${payload.videoCount} 个视频将自动上传` : '', payload.videoFallbacks ? `${payload.videoFallbacks} 个视频暂保留为链接` : ''].filter(Boolean).join('，'))
      active.current = true
      // Let an in-flight start acknowledge before cancelling: never leave an orphan draft run.
      await requestPublishExtension('start', payload)
      if (controller.signal.aborted) { await requestPublishExtension('cancel'); return }
      const deadline = Date.now() + 9 * 60_000
      while (!controller.signal.aborted) {
        if (Date.now() > deadline) throw new Error('发送超时，请检查平台草稿后重试。')
        const progress = await requestPublishExtension<PublishProgress>('status', undefined, controller.signal)
        if (controller.signal.aborted) return
        setStatus(progress)
        if (progress.state !== 'running') { active.current = false; return }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    } catch (error) {
      if (active.current) void requestPublishExtension('cancel').catch(() => {})
      active.current = false
      if (!controller.signal.aborted) setStatus({ state: 'error', text: error instanceof Error ? error.message : '发送失败，请重试。' })
    }
  }
  const stop = () => {
    abort.current?.abort()
    if (active.current) void requestPublishExtension('cancel').catch(() => {})
    active.current = false
    setStatus({ state: 'cancelled', text: '已停止；已写入的部分草稿会保留。' })
  }
  const url = draftUrl(target, status?.url)
  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[var(--editor-line)] bg-[var(--editor-panel)] p-5 text-[var(--editor-ink)] shadow-xl backdrop:bg-black/40">
    <div className="flex items-center justify-between gap-3"><h2 id={titleId} className="font-semibold">发送到{label}草稿</h2><button type="button" aria-label="关闭" disabled={busy} onClick={onClose} className="rounded p-2 disabled:opacity-40"><X className="h-4 w-4" /></button></div>
    <p className="mt-3 text-sm text-[var(--editor-muted)]">自动打开{label}并写入草稿，检查后即可发布。</p>
    <p role="status" aria-live="polite" className="my-4 break-words text-sm">{status?.error?.message || status?.text || (status?.state === 'done' ? '草稿已写入，请前往平台检查。' : '将发送当前编辑内容。')}</p>
    {videoNote && <p className="mb-3 text-xs text-[var(--editor-muted)]">{videoNote}</p>}
    {converted && <p className="mb-4 text-xs text-[var(--editor-muted)]">音视频和嵌入内容已转为链接，原文未改动。</p>}
    <div className="flex justify-end gap-2">{url && <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-md border border-[var(--editor-line)] px-3 py-2 text-sm">查看草稿</a>}{busy ? <button type="button" onClick={stop} className="rounded-md border border-[var(--editor-line)] px-3 py-2 text-sm">停止</button> : <button type="button" onClick={() => void send()} className="rounded-md bg-[var(--editor-accent)] px-3 py-2 text-sm text-white">{status?.state === 'done' ? '再发送一份' : '发送草稿'}</button>}</div>
  </dialog>
}
