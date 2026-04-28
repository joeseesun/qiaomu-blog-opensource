'use client'

import { useCallback, useEffect, useState } from 'react'
import { Dropdown } from '@/components/Dropdown'
import { useToast } from '@/components/Toast'
import { Modal } from '@/components/Modal'
import {
  AI_IMAGE_ASPECT_RATIO_OPTIONS,
  AI_IMAGE_RESOLUTION_OPTIONS,
  getAiImageAspectRatioLabel,
  getAiImageResolutionLabel,
  type AIImageAspectRatio,
  type AIImageResolution,
} from '@/lib/ai-image-options'

interface AiImageAction {
  id: number
  action_key: string
  label: string
  description: string
  prompt: string
  aspect_ratio: AIImageAspectRatio
  resolution: AIImageResolution
  size: string
  quality: string
  profile_id: number | null
  sort_order: number
  is_enabled: number
  is_builtin: number
}

interface AiImageProfile {
  id: number
  name: string
  model: string
  is_default: number
}

const emptyAction: Partial<AiImageAction> = {
  action_key: '',
  label: '',
  description: '',
  prompt: '',
  aspect_ratio: '16:9',
  resolution: '2k',
  profile_id: null,
}

export function AiImageActionsManager() {
  const toast = useToast()
  const [actions, setActions] = useState<AiImageAction[]>([])
  const [profiles, setProfiles] = useState<AiImageProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [editAction, setEditAction] = useState<Partial<AiImageAction> | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AiImageAction | null>(null)

  const profileOptions = profiles.map((profile) => ({
    ...profile,
    label: profile.is_default ? `${profile.name}（默认）` : profile.name,
    detail: profile.model,
  }))

  const loadData = useCallback(async () => {
    try {
      const [actionsRes, profilesRes] = await Promise.all([
        fetch('/api/admin/ai-image-actions'),
        fetch('/api/admin/ai-image-provider'),
      ])

      if (actionsRes.ok) {
        const actionData = await actionsRes.json() as { actions: AiImageAction[] }
        setActions(actionData.actions || [])
      }

      if (profilesRes.ok) {
        const profileData = await profilesRes.json() as { profiles: AiImageProfile[] }
        setProfiles(profileData.profiles || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const getProfileName = (profileId: number | null | undefined) => {
    if (!profileId) return '未绑定'
    const profile = profiles.find((item) => item.id === profileId)
    return profile ? profile.name : '未绑定'
  }

  const handleSave = async () => {
    if (!editAction) return

    if (!editAction.action_key?.trim() || !editAction.label?.trim() || !editAction.description?.trim() || !editAction.prompt?.trim()) {
      toast.error('请填写所有必填字段')
      return
    }

    setSaving(true)

    try {
      const payload = {
        ...editAction,
        action_key: editAction.action_key?.trim(),
        label: editAction.label?.trim(),
        description: editAction.description?.trim(),
        prompt: editAction.prompt?.trim(),
        aspect_ratio: editAction.aspect_ratio || 'auto',
        resolution: editAction.resolution || 'auto',
        profile_id: Number.isFinite(editAction.profile_id) ? Number(editAction.profile_id) : null,
      }

      if (isNew) {
        const res = await fetch('/api/admin/ai-image-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({})) as { error?: string }
        if (!res.ok) throw new Error(data.error || '创建失败')
        toast.success('图片提示已创建')
      } else {
        const res = await fetch(`/api/admin/ai-image-actions/${editAction.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({})) as { error?: string }
        if (!res.ok) throw new Error(data.error || '保存失败')
        toast.success('图片提示已更新')
      }

      setEditAction(null)
      setIsNew(false)
      await loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return

    try {
      const res = await fetch(`/api/admin/ai-image-actions/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error || '删除失败')
      toast.success('图片提示已删除')
      setDeleteTarget(null)
      await loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  const toggleEnabled = async (action: AiImageAction) => {
    try {
      const res = await fetch(`/api/admin/ai-image-actions/${action.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: action.is_enabled ? 0 : 1 }),
      })
      if (!res.ok) throw new Error()
      await loadData()
    } catch {
      toast.error('更新失败')
    }
  }

  const moveAction = async (index: number, direction: 'up' | 'down') => {
    const nextActions = [...actions]
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= nextActions.length) return

    const tempSort = nextActions[index].sort_order
    nextActions[index].sort_order = nextActions[swapIndex].sort_order
    nextActions[swapIndex].sort_order = tempSort

    try {
      const res = await fetch('/api/admin/ai-image-actions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { id: nextActions[index].id, sort_order: nextActions[index].sort_order },
            { id: nextActions[swapIndex].id, sort_order: nextActions[swapIndex].sort_order },
          ],
        }),
      })
      if (!res.ok) throw new Error()
      await loadData()
    } catch {
      toast.error('排序失败')
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-sm text-[var(--editor-muted)]">加载中…</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--editor-ink)]">图片快捷提示</h3>
        <button
          type="button"
          onClick={() => {
            const defaultProfile = profiles.find((profile) => profile.is_default === 1)
            setEditAction({ ...emptyAction, profile_id: defaultProfile?.id ?? null })
            setIsNew(true)
          }}
          className="rounded-lg bg-[var(--editor-accent)] px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-105"
        >
          + 新增提示
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--editor-line)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--editor-soft)] text-left">
              <th className="w-16 px-3 py-2 font-medium text-[var(--editor-muted)]">排序</th>
              <th className="px-3 py-2 font-medium text-[var(--editor-muted)]">标识</th>
              <th className="px-3 py-2 font-medium text-[var(--editor-muted)]">名称</th>
              <th className="hidden px-3 py-2 font-medium text-[var(--editor-muted)] sm:table-cell">描述</th>
              <th className="hidden px-3 py-2 font-medium text-[var(--editor-muted)] md:table-cell">比例</th>
              <th className="hidden px-3 py-2 font-medium text-[var(--editor-muted)] md:table-cell">分辨率</th>
              <th className="hidden px-3 py-2 font-medium text-[var(--editor-muted)] lg:table-cell">模型配置</th>
              <th className="w-16 px-3 py-2 text-center font-medium text-[var(--editor-muted)]">启用</th>
              <th className="w-24 px-3 py-2 text-right font-medium text-[var(--editor-muted)]">操作</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((action, index) => (
              <tr key={action.id} className="border-t border-[var(--editor-line)] hover:bg-[var(--editor-panel)]">
                <td className="px-3 py-2">
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveAction(index, 'up')}
                      className="rounded px-1 text-[var(--editor-muted)] hover:bg-[var(--editor-soft)] disabled:opacity-30"
                      title="上移一行"
                      aria-label="上移一行"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === actions.length - 1}
                      onClick={() => moveAction(index, 'down')}
                      className="rounded px-1 text-[var(--editor-muted)] hover:bg-[var(--editor-soft)] disabled:opacity-30"
                      title="下移一行"
                      aria-label="下移一行"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--editor-muted)]">{action.action_key}</td>
                <td className="px-3 py-2 font-medium text-[var(--editor-ink)]">{action.label}</td>
                <td className="hidden px-3 py-2 text-[var(--editor-muted)] sm:table-cell">{action.description}</td>
                <td className="hidden px-3 py-2 text-xs text-[var(--editor-muted)] md:table-cell">{getAiImageAspectRatioLabel(action.aspect_ratio)}</td>
                <td className="hidden px-3 py-2 text-xs text-[var(--editor-muted)] md:table-cell">{getAiImageResolutionLabel(action.resolution)}</td>
                <td className="hidden px-3 py-2 text-xs text-[var(--editor-muted)] lg:table-cell">{getProfileName(action.profile_id)}</td>
                <td className="px-3 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => toggleEnabled(action)}
                    className={`inline-block h-4 w-4 rounded-full transition ${action.is_enabled ? 'bg-emerald-500' : 'bg-[var(--editor-line)]'}`}
                    title={action.is_enabled ? '已启用（点击禁用）' : '已禁用（点击启用）'}
                    aria-label={action.is_enabled ? '禁用此操作' : '启用此操作'}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setEditAction({ ...action })
                      setIsNew(false)
                    }}
                    className="text-xs text-[var(--editor-accent)] hover:underline"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(action)}
                    className="ml-2 text-xs text-rose-500 hover:underline"
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setEditAction(null)}>
          <div className="mx-4 w-full max-w-2xl rounded-xl border border-[var(--editor-line)] bg-[var(--editor-panel)] p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold text-[var(--editor-ink)]">
              {isNew ? '新增图片提示' : '编辑图片提示'}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--editor-ink)]">提示标识 *</label>
                <input
                  type="text"
                  value={editAction.action_key || ''}
                  onChange={(event) => setEditAction({ ...editAction, action_key: event.target.value })}
                  className="w-full rounded-lg border border-[var(--editor-line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--editor-ink)]">名称 *</label>
                <input
                  type="text"
                  value={editAction.label || ''}
                  onChange={(event) => setEditAction({ ...editAction, label: event.target.value })}
                  className="w-full rounded-lg border border-[var(--editor-line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--editor-ink)]">描述 *</label>
                <input
                  type="text"
                  value={editAction.description || ''}
                  onChange={(event) => setEditAction({ ...editAction, description: event.target.value })}
                  className="w-full rounded-lg border border-[var(--editor-line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--editor-ink)]">风格提示词 *</label>
                <textarea
                  rows={6}
                  value={editAction.prompt || ''}
                  onChange={(event) => setEditAction({ ...editAction, prompt: event.target.value })}
                  className="w-full rounded-lg border border-[var(--editor-line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
                />
                <div className="mt-1 text-xs text-[var(--editor-muted)]">
                  这里写的是风格模板。编辑器里用户输入的主题与正文上下文会自动拼接进去。
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-[var(--editor-line)] bg-[var(--editor-soft)]/60 p-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[var(--editor-ink)]">图片比例</label>
                  <div className="flex flex-wrap gap-2">
                    {AI_IMAGE_ASPECT_RATIO_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setEditAction({ ...editAction, aspect_ratio: option.value })}
                        className={`rounded-full border px-3 py-1.5 text-sm transition ${
                          (editAction.aspect_ratio || 'auto') === option.value
                            ? 'border-[var(--editor-accent)] bg-[var(--editor-accent)]/10 text-[var(--editor-accent)]'
                            : 'border-[var(--editor-line)] bg-white text-[var(--editor-ink)] hover:bg-[var(--editor-soft)]'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[var(--editor-ink)]">分辨率</label>
                    <select
                      value={editAction.resolution || 'auto'}
                      onChange={(event) => setEditAction({ ...editAction, resolution: event.target.value as AIImageResolution })}
                      className="w-full rounded-lg border border-[var(--editor-line)] bg-white px-3 py-2 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
                    >
                      {AI_IMAGE_RESOLUTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[var(--editor-ink)]">模型配置</label>
                    <Dropdown
                      options={[
                        { value: '', label: '未绑定' },
                        ...profileOptions.map((profile) => ({
                          value: String(profile.id),
                          label: `${profile.label} · ${profile.detail}`,
                        })),
                      ]}
                      value={String(editAction.profile_id ?? '')}
                      onChange={(value) => {
                        setEditAction({ ...editAction, profile_id: value ? Number(value) : null })
                      }}
                      placeholder="搜索并选择模型配置"
                    />
                  </div>
                </div>

                <div className="text-xs text-[var(--editor-muted)]">
                  编辑器里会自动带出这里配置的比例、分辨率和模型。不同模型会自动映射到最接近支持的尺寸与清晰度。
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditAction(null)}
                className="rounded-lg border border-[var(--editor-line)] px-4 py-2 text-sm text-[var(--editor-ink)] hover:bg-[var(--editor-soft)]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-[var(--editor-accent)] px-4 py-2 text-sm font-semibold text-white hover:brightness-105 disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <Modal
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title="确认删除"
          description={`确定要删除图片提示「${deleteTarget.label}」吗？此操作不可撤销。`}
          confirmText="删除"
          type="danger"
        />
      )}
    </div>
  )
}
