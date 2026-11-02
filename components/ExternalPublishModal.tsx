'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { bridgeRequest, draftUrl, prepareExternalArticle, type ExternalPublishTarget, type PublishArticle, type PublishProgress } from '@/lib/external-publish'

export function ExternalPublishModal({ target, getArticle, onClose }: { target: ExternalPublishTarget; getArticle: () => PublishArticle; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const abort = useRef<AbortController | null>(null)
  const control = useRef('')
  const [status, setStatus] = useState<PublishProgress | null>(null)
  const busy = status?.state === 'running'
  const label = target === 'x' ? 'X 文章' : '知乎'
  useEffect(() => {
    dialog.current?.showModal()
    return () => { abort.current?.abort(); if (control.current) void bridgeRequest('/job', { method: 'DELETE', headers: { authorization: `Bearer ${control.current}` } }).catch(() => {}) }
  }, [])
  const send = async () => {
    // Open synchronously so image preparation cannot trigger popup blocking.
    const tab = window.open('about:blank', '_blank')
    if (!tab) { setStatus({ state: 'error', text: '浏览器阻止了新窗口，请允许弹出窗口后重试。' }); return }
    tab.opener = null
    let navigated = false
    const controller = new AbortController(); abort.current = controller
    setStatus({ state: 'running', text: '正在准备正文和图片…' })
    try {
      await bridgeRequest('/health')
      const payload = await prepareExternalArticle(target, getArticle(), controller.signal)
      if (controller.signal.aborted) return
      const result = await bridgeRequest('/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      control.current = result.control
      if (controller.signal.aborted) { await bridgeRequest('/job', { method: 'DELETE', headers: { authorization: `Bearer ${result.control}` } }); return }
      tab.location.href = result.url
      navigated = true
      const deadline = Date.now() + 9 * 60_000
      while (!controller.signal.aborted) {
        if (tab.closed) throw new Error('平台窗口已关闭，请重试。')
        if (Date.now() > deadline) throw new Error('等待超时，请检查 Clipper 已启用、平台已登录，再重试。')
        const progress: PublishProgress = await bridgeRequest('/job', { headers: { authorization: `Bearer ${result.control}` } })
        if (controller.signal.aborted) return
        setStatus(progress)
        if (progress.state !== 'running') { control.current = ''; return }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    } catch (error) {
      if (!navigated) tab.close()
      if (!controller.signal.aborted) setStatus({ state: 'error', text: error instanceof Error ? error.message : '发送失败，请重试。' })
    } finally { if (!navigated) tab.close() }
  }
  const stop = async () => {
    abort.current?.abort()
    const key = control.current
    control.current = ''
    if (key) await bridgeRequest('/job', { method: 'DELETE', headers: { authorization: `Bearer ${key}` } }).catch(() => {})
    setStatus({ state: 'cancelled', text: '已停止；平台可能已保留部分草稿，请检查后再重试。' })
  }
  const url = draftUrl(target, status?.url)
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[var(--editor-line)] bg-[var(--editor-panel)] p-5 text-[var(--editor-ink)] shadow-xl backdrop:bg-black/40">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">发送到{label}草稿</h2><button type="button" aria-label="关闭" disabled={busy} onClick={onClose} className="rounded p-2 disabled:opacity-40"><X className="h-4 w-4" /></button></div>
    <p className="mt-3 text-sm text-[var(--editor-muted)]">请在装有乔木 Clipper 的浏览器中登录{label}。写入草稿后，由你检查并发布。</p>
    <p className="mt-3 text-sm text-[var(--editor-muted)]">发送前，在电脑的博客项目目录运行：</p><code className="mt-1 block select-all rounded bg-[var(--editor-soft)] p-2 text-sm">npm run publish:bridge</code>
    <p role="status" aria-live="polite" className="my-4 break-words text-sm">{status?.error?.message || status?.text || (status?.state === 'done' ? '草稿已写入，请前往平台检查。' : '将发送当前编辑内容。') }</p>
    <div className="flex justify-end gap-2">{url && <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-md border border-[var(--editor-line)] px-3 py-2 text-sm">查看草稿</a>}{busy ? <button type="button" onClick={() => void stop()} className="rounded-md border border-[var(--editor-line)] px-3 py-2 text-sm">停止</button> : <button type="button" onClick={() => void send()} className="rounded-md bg-[var(--editor-accent)] px-3 py-2 text-sm text-white">{status?.state === 'done' ? '再发送一份' : '发送草稿'}</button>}</div>
  </dialog>
}
