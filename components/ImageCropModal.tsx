'use client'

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { Crop, Loader2, Move, Search, X } from 'lucide-react'
import {
  cropImageForUpload,
  EDITOR_IMAGE_OPTIMIZE_OPTIONS,
  type CropAreaPixels,
} from '@/lib/client-image'

type CropAspectPreset = 'free' | '16:9' | '4:3' | '1:1'
type CropPlacementMode = 'replace' | 'insert'

const ASPECT_OPTIONS: Array<{
  value: CropAspectPreset
  label: string
  aspect?: number
}> = [
  { value: 'free', label: '自由' },
  { value: '16:9', label: '16:9', aspect: 16 / 9 },
  { value: '4:3', label: '4:3', aspect: 4 / 3 },
  { value: '1:1', label: '1:1', aspect: 1 },
]

interface ImageCropModalProps {
  open: boolean
  imageUrl: string
  imageAlt?: string
  defaultPlacementMode?: CropPlacementMode
  onClose: () => void
  onApply: (file: File, placementMode: CropPlacementMode) => Promise<void> | void
}

export function ImageCropModal({
  open,
  imageUrl,
  imageAlt = '',
  defaultPlacementMode = 'replace',
  onClose,
  onApply,
}: ImageCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [aspectPreset, setAspectPreset] = useState<CropAspectPreset>('free')
  const [placementMode, setPlacementMode] = useState<CropPlacementMode>(defaultPlacementMode)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<CropAreaPixels | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const aspectValue = useMemo(
    () => ASPECT_OPTIONS.find((option) => option.value === aspectPreset)?.aspect,
    [aspectPreset],
  )

  useEffect(() => {
    if (!open) return
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setAspectPreset('free')
    setPlacementMode(defaultPlacementMode)
    setCroppedAreaPixels(null)
    setError('')
  }, [defaultPlacementMode, open, imageUrl])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose, submitting])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/55 px-3 py-3 sm:px-4 sm:py-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose()
      }}
    >
      <div className="flex min-h-full items-center justify-center">
        <div className="flex w-full max-w-5xl max-h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-[28px] border border-[var(--editor-line)] bg-[var(--editor-panel)] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
          <div className="flex items-start justify-between gap-4 border-b border-[var(--editor-line)] px-5 py-4">
            <div className="min-w-0">
              <div className="text-base font-semibold text-[var(--editor-ink)]">裁剪图片</div>
              <div className="mt-1 text-sm text-[var(--editor-muted)]">拖动调整取景区域，裁完后可以替换当前图或插入新图。</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--editor-muted)] transition hover:bg-[var(--editor-soft)] hover:text-[var(--editor-ink)] disabled:opacity-50"
              title="关闭裁剪面板"
              aria-label="关闭裁剪面板"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.15fr)_320px]">
            <div className="relative min-h-[360px] bg-[#111] lg:min-h-[520px]">
              <Cropper
                image={imageUrl}
                crop={crop}
                zoom={zoom}
                aspect={aspectValue}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, areaPixels: Area) => {
                  setCroppedAreaPixels({
                    width: areaPixels.width,
                    height: areaPixels.height,
                    x: areaPixels.x,
                    y: areaPixels.y,
                  })
                }}
                showGrid={false}
                objectFit="contain"
              />
            </div>

            <div className="min-h-0 border-t border-[var(--editor-line)] lg:border-l lg:border-t-0">
              <div className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-[var(--editor-muted)]">原图预览</div>
                    <div className="overflow-hidden rounded-2xl border border-[var(--editor-line)] bg-white">
                      <img
                        src={imageUrl}
                        alt={imageAlt || '待裁剪图片'}
                        className="aspect-[4/3] w-full object-cover"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-[var(--editor-muted)]">裁剪比例</div>
                    <div className="flex flex-wrap gap-2">
                      {ASPECT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setAspectPreset(option.value)}
                          className={`rounded-full border px-3 py-1.5 text-sm transition ${
                            aspectPreset === option.value
                              ? 'border-[var(--editor-accent)] bg-[var(--editor-accent)]/10 text-[var(--editor-accent)]'
                              : 'border-[var(--editor-line)] text-[var(--editor-ink)] hover:bg-[var(--editor-soft)]'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-[var(--editor-muted)]">输出方式</div>
                    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[var(--editor-soft)] p-1">
                      <button
                        type="button"
                        onClick={() => setPlacementMode('replace')}
                        className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                          placementMode === 'replace'
                            ? 'bg-white text-[var(--editor-ink)] shadow-sm'
                            : 'text-[var(--editor-muted)] hover:text-[var(--editor-ink)]'
                        }`}
                      >
                        替换当前图
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlacementMode('insert')}
                        className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                          placementMode === 'insert'
                            ? 'bg-white text-[var(--editor-ink)] shadow-sm'
                            : 'text-[var(--editor-muted)] hover:text-[var(--editor-ink)]'
                        }`}
                      >
                        插入新图
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--editor-line)] bg-[var(--editor-soft)]/60 p-4 text-sm text-[var(--editor-muted)]">
                    <div className="flex items-center gap-2">
                      <Move className="h-4 w-4" />
                      <span>拖动画面调整取景区域</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Search className="h-4 w-4" />
                      <span>拖动下方滑块控制缩放</span>
                    </div>
                    <div className="mt-4">
                      <label className="mb-2 block text-xs font-medium text-[var(--editor-muted)]">缩放</label>
                      <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.01}
                        value={zoom}
                        onChange={(event) => setZoom(Number(event.target.value))}
                        className="w-full accent-[var(--editor-accent)]"
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t border-[var(--editor-line)] px-5 py-4">
                  {error ? (
                    <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {error}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={submitting}
                      className="rounded-xl border border-[var(--editor-line)] px-4 py-2 text-sm text-[var(--editor-ink)] transition hover:bg-[var(--editor-soft)] disabled:opacity-50"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={submitting || !croppedAreaPixels}
                      onClick={async () => {
                        if (!croppedAreaPixels) return

                        setSubmitting(true)
                        setError('')

                        try {
                          const croppedFile = await cropImageForUpload(
                            imageUrl,
                            croppedAreaPixels,
                            EDITOR_IMAGE_OPTIMIZE_OPTIONS,
                            imageAlt || 'cropped-image',
                          )

                          await onApply(croppedFile, placementMode)
                        } catch (nextError) {
                          setError(nextError instanceof Error ? nextError.message : '裁剪失败')
                        } finally {
                          setSubmitting(false)
                        }
                      }}
                      className="inline-flex items-center gap-2 rounded-xl bg-[var(--editor-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crop className="h-4 w-4" />}
                      {placementMode === 'replace' ? '裁剪并替换' : '裁剪并插入'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
