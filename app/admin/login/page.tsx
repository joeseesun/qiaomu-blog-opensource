'use client'

import Link from 'next/link'
import { Suspense, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { resolveLoginRedirect } from '@/lib/login-redirect'

function AdminLoginForm() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      const data = await res.json().catch(() => null) as { error?: string } | null

      if (res.ok) {
        // 安全检查：只允许跳转到本站路径或白名单站点（www.qiaomu.ai 的随想发布入口）
        const target = resolveLoginRedirect(searchParams.get('redirect_to'))
        if (target.startsWith('/')) {
          router.push(target)
          router.refresh()
        } else {
          window.location.assign(target)
        }
      } else {
        setError(
          typeof data?.error === 'string'
            ? data.error
            : res.status === 401
              ? '密码错误，请重试'
              : '登录服务暂不可用，请稍后重试'
        )
      }
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--editor-app-bg)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#1f6f59] text-white text-xl font-bold mb-4">
            乔
          </div>
          <h1 className="text-2xl font-bold text-[var(--editor-ink)]">乔木博客</h1>
          <p className="text-sm text-[var(--editor-muted)] mt-1">管理后台</p>
        </div>

        {/* 登录表单 */}
        <div className="bg-[var(--editor-panel)] rounded-2xl border border-[var(--editor-line)] shadow-[0_8px_28px_rgba(37,32,24,0.08)] p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[var(--editor-ink)] mb-2"
              >
                管理密码
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (error) setError('')
                }}
                placeholder="请输入管理密码"
                autoFocus
                autoComplete="current-password"
                className="w-full border border-[var(--editor-line)] rounded-lg px-3.5 py-2.5 text-sm text-[var(--editor-ink)] bg-[var(--editor-app-bg)] outline-none transition focus:border-[#1f6f59] focus:ring-2 focus:ring-[#1f6f59]/10 placeholder:text-[var(--editor-muted)]"
              />
            </div>

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-[#1f6f59] text-white rounded-lg py-2.5 text-sm font-semibold hover:brightness-105 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '登录中…' : '登录'}
            </button>
          </form>
        </div>

        <p className="text-center mt-6 text-xs text-[var(--editor-muted)]">
          <Link href="/" className="hover:text-[var(--editor-ink)] transition-colors">
            ← 返回博客首页
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function AdminLogin() {
  return (
    <Suspense fallback={null}>
      <AdminLoginForm />
    </Suspense>
  )
}
