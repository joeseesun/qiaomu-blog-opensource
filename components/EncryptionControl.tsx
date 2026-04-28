'use client'

import { useState } from 'react'
import { generatePassword } from '@/lib/password'

interface EncryptionControlProps {
  initialPassword: string | null
  onChange: (password: string | null) => void
  articleUrl?: string
}

export function EncryptionControl({ initialPassword, onChange, articleUrl }: EncryptionControlProps) {
  const [isEncrypted, setIsEncrypted] = useState(!!initialPassword)
  const [password, setPassword] = useState(initialPassword || '')
  const [showPanel, setShowPanel] = useState(false)
  const [copied, setCopied] = useState<'url' | 'password' | null>(null)

  const handleToggle = () => {
    if (isEncrypted) {
      // 取消加密
      setIsEncrypted(false)
      setPassword('')
      setShowPanel(false)
      onChange(null)
    } else {
      // 启用加密，生成随机密码
      const newPassword = generatePassword()
      setIsEncrypted(true)
      setPassword(newPassword)
      setShowPanel(true)
      onChange(newPassword)
    }
  }

  const handlePasswordChange = (newPassword: string) => {
    setPassword(newPassword)
    onChange(newPassword)
  }

  const copyToClipboard = async (text: string, type: 'url' | 'password') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type)
      setTimeout(() => setCopied(null), 2000)
    } catch (err) {
      console.error('复制失败:', err)
    }
  }

  const fullUrl = articleUrl && password
    ? `${articleUrl}?pwd=${encodeURIComponent(password)}`
    : articleUrl || ''

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className={`p-2 rounded-md transition-colors ${
          isEncrypted
            ? 'bg-[var(--editor-accent)] text-white'
            : 'bg-[var(--editor-soft)] text-[var(--editor-muted)] hover:bg-[var(--editor-line)]'
        }`}
        title={isEncrypted ? '取消加密' : '加密文章'}
        aria-label={isEncrypted ? '取消加密' : '加密文章'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {isEncrypted ? (
            <>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </>
          ) : (
            <>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
            </>
          )}
        </svg>
      </button>

      {isEncrypted && (
        <button
          type="button"
          onClick={() => setShowPanel(!showPanel)}
          className="ml-1 p-2 rounded-md bg-[var(--editor-soft)] text-[var(--editor-muted)] hover:bg-[var(--editor-line)] transition-colors"
          title="查看密码"
          aria-label="查看密码"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
      )}

      {showPanel && isEncrypted && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-[var(--editor-panel)] rounded-lg border border-[var(--editor-line)] shadow-lg p-4 z-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--editor-ink)]">文章加密</h3>
            <button
              type="button"
              onClick={() => setShowPanel(false)}
              className="text-[var(--editor-muted)] hover:text-[var(--editor-ink)] transition-colors"
              title="关闭面板"
              aria-label="关闭面板"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[var(--editor-muted)] mb-1">
                访问密码
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm rounded-md border border-[var(--editor-line)] bg-[var(--background)] text-[var(--editor-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--editor-accent)] focus:border-transparent"
                  placeholder="输入密码"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(password, 'password')}
                  className="px-3 py-2 text-sm rounded-md border border-[var(--editor-line)] bg-[var(--background)] text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition-colors"
                  title="复制密码"
                >
                  {copied === 'password' ? '✓' : '复制'}
                </button>
              </div>
            </div>

            {articleUrl && (
              <div>
                <label className="block text-xs font-medium text-[var(--editor-muted)] mb-1">
                  分享链接
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={fullUrl}
                    readOnly
                    className="flex-1 px-3 py-2 text-sm rounded-md border border-[var(--editor-line)] bg-[var(--editor-soft)] text-[var(--editor-muted)] text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(fullUrl, 'url')}
                    className="px-3 py-2 text-sm rounded-md border border-[var(--editor-line)] bg-[var(--background)] text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition-colors"
                    title="复制链接"
                  >
                    {copied === 'url' ? '✓' : '复制'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-[var(--stone-gray)]">
                  链接中已包含密码，可直接访问
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
