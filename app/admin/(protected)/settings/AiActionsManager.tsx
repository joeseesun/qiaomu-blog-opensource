'use client'

import { useState, useEffect, useCallback } from 'react'
import { Dropdown } from '@/components/Dropdown'
import { useToast } from '@/components/Toast'
import { Modal } from '@/components/Modal'

interface AiAction {
  id: number
  action_key: string
  label: string
  description: string
  prompt: string
  temperature: number
  profile_id: number | null
  sort_order: number
  is_enabled: number
  is_builtin: number
}

interface AiProfile {
  id: number
  name: string
  is_default: number
}

const emptyAction: Partial<AiAction> = {
  action_key: '',
  label: '',
  description: '',
  prompt: '',
  temperature: 0.6,
  profile_id: null,
}

export function AiActionsManager() {
  const toast = useToast()
  const [actions, setActions] = useState<AiAction[]>([])
  const [profiles, setProfiles] = useState<AiProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [editAction, setEditAction] = useState<Partial<AiAction> | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AiAction | null>(null)

  const profileOptions = profiles.map(p => ({
    ...p,
    label: p.is_default ? `${p.name}（默认）` : p.name,
  }))

  const loadData = useCallback(async () => {
    try {
      const [actionsRes, profilesRes] = await Promise.all([
        fetch('/api/admin/ai-actions'),
        fetch('/api/admin/ai-provider'),
      ])

      if (actionsRes.ok) {
        const actionData = await actionsRes.json() as { actions: AiAction[] }
        setActions(actionData.actions || [])
      }

      if (profilesRes.ok) {
        const profileData = await profilesRes.json() as { profiles: AiProfile[] }
        setProfiles(profileData.profiles || [])
      }
    } catch {
      // noop
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const getProfileName = (profileId: number | null | undefined) => {
    if (!profileId) return '未绑定'
    const profile = profiles.find(p => p.id === profileId)
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
        temperature: Number(editAction.temperature ?? 0.6),
        profile_id: Number.isFinite(editAction.profile_id) ? Number(editAction.profile_id) : null,
      }

      if (isNew) {
        const res = await fetch('/api/admin/ai-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({})) as { error?: string }
        if (!res.ok) throw new Error(data.error || '创建失败')
        toast.success('操作已创建')
      } else {
        const res = await fetch(`/api/admin/ai-actions/${editAction.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({})) as { error?: string }
        if (!res.ok) throw new Error(data.error || '保存失败')
        toast.success('操作已更新')
      }

      setEditAction(null)
      setIsNew(false)
      loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      const res = await fetch(`/api/admin/ai-actions/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error || '删除失败')
      toast.success('操作已删除')
      setDeleteTarget(null)
      loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  const toggleEnabled = async (action: AiAction) => {
    try {
      const res = await fetch(`/api/admin/ai-actions/${action.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: action.is_enabled ? 0 : 1 }),
      })
      if (!res.ok) throw new Error()
      loadData()
    } catch {
      toast.error('更新失败')
    }
  }

  const moveAction = async (index: number, direction: 'up' | 'down') => {
    const arr = [...actions]
    const swapIdx = direction === 'up' ? index - 1 : index + 1
    if (swapIdx < 0 || swapIdx >= arr.length) return

    const tempSort = arr[index].sort_order
    arr[index].sort_order = arr[swapIdx].sort_order
    arr[swapIdx].sort_order = tempSort

    try {
      await fetch('/api/admin/ai-actions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { id: arr[index].id, sort_order: arr[index].sort_order },
            { id: arr[swapIdx].id, sort_order: arr[swapIdx].sort_order },
          ],
        }),
      })
      loadData()
    } catch {
      toast.error('排序失败')
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-[var(--editor-muted)]">加载中…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--editor-ink)]">AI 快捷操作</h3>
        <button
          type="button"
          onClick={() => {
            const defaultProfile = profiles.find(p => p.is_default === 1)
            setEditAction({ ...emptyAction, profile_id: defaultProfile?.id ?? null })
            setIsNew(true)
          }}
          className="rounded-lg bg-[var(--editor-accent)] px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-105"
        >
          + 新增操作
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
              <th className="hidden px-3 py-2 font-medium text-[var(--editor-muted)] md:table-cell">模型配置</th>
              <th className="w-16 px-3 py-2 text-center font-medium text-[var(--editor-muted)]">启用</th>
              <th className="w-24 px-3 py-2 text-right font-medium text-[var(--editor-muted)]">操作</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((action, idx) => (
              <tr key={action.id} className="border-t border-[var(--editor-line)] hover:bg-[var(--editor-panel)]">
                <td className="px-3 py-2">
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveAction(idx, 'up')}
                      className="rounded px-1 text-[var(--editor-muted)] hover:bg-[var(--editor-soft)] disabled:opacity-30"
                      title="上移一行"
                      aria-label="上移一行"
                    >↑</button>
                    <button
                      type="button"
                      disabled={idx === actions.length - 1}
                      onClick={() => moveAction(idx, 'down')}
                      className="rounded px-1 text-[var(--editor-muted)] hover:bg-[var(--editor-soft)] disabled:opacity-30"
                      title="下移一行"
                      aria-label="下移一行"
                    >↓</button>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--editor-muted)]">{action.action_key}</td>
                <td className="px-3 py-2 font-medium text-[var(--editor-ink)]">{action.label}</td>
                <td className="hidden px-3 py-2 text-[var(--editor-muted)] sm:table-cell">{action.description}</td>
                <td className="hidden px-3 py-2 text-xs text-[var(--editor-muted)] md:table-cell">{getProfileName(action.profile_id)}</td>
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
                    onClick={() => { setEditAction({ ...action }); setIsNew(false) }}
                    className="text-xs text-[var(--editor-accent)] hover:underline"
                  >编辑</button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(action)}
                    className="ml-2 text-xs text-rose-500 hover:underline"
                  >删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setEditAction(null)}>
          <div className="mx-4 w-full max-w-lg rounded-xl border border-[var(--editor-line)] bg-[var(--editor-panel)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold text-[var(--editor-ink)]">
              {isNew ? '新增 AI 操作' : '编辑 AI 操作'}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--editor-ink)]">操作标识 *</label>
                <input
                  type="text"
                  value={editAction.action_key || ''}
                  onChange={e => setEditAction({ ...editAction, action_key: e.target.value })}
                  className="w-full rounded-lg border border-[var(--editor-line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--editor-ink)]">操作名称 *</label>
                <input
                  type="text"
                  value={editAction.label || ''}
                  onChange={e => setEditAction({ ...editAction, label: e.target.value })}
                  className="w-full rounded-lg border border-[var(--editor-line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--editor-ink)]">描述 *</label>
                <input
                  type="text"
                  value={editAction.description || ''}
                  onChange={e => setEditAction({ ...editAction, description: e.target.value })}
                  className="w-full rounded-lg border border-[var(--editor-line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--editor-ink)]">提示词 *</label>
                <textarea
                  rows={5}
                  value={editAction.prompt || ''}
                  onChange={e => setEditAction({ ...editAction, prompt: e.target.value })}
                  className="w-full rounded-lg border border-[var(--editor-line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-[var(--editor-ink)]">温度</label>
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={editAction.temperature ?? 0.6}
                    onChange={e => setEditAction({ ...editAction, temperature: Number(e.target.value) })}
                    className="w-full rounded-lg border border-[var(--editor-line)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-[var(--editor-ink)]">模型配置</label>
                  <Dropdown
                    options={[
                      { value: '', label: '未绑定' },
                      ...profileOptions.map((profile) => ({
                        value: String(profile.id),
                        label: profile.label,
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
          description={`确定要删除操作「${deleteTarget.label}」吗？此操作不可撤销。`}
          confirmText="删除"
          type="danger"
        />
      )}
    </div>
  )
}
