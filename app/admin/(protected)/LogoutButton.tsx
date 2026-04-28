'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

export function LogoutButton() {
  const router = useRouter()

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' })
    router.push('/admin/login')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="p-2 rounded-lg text-[var(--editor-muted)] hover:text-rose-500 hover:bg-[var(--editor-soft)] transition-all"
      title="退出登录"
      aria-label="退出登录"
    >
      <LogOut className="w-4 h-4" />
    </button>
  )
}

