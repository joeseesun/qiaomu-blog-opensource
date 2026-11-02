// After login, go back to a path on this site or to one of the sites that use the admin
// session cross-origin (www.qiaomu.ai/notes/ writes memos here). Anything else goes to /admin.
const EXTERNAL_RETURN_ORIGINS = ['https://www.qiaomu.ai']

export function resolveLoginRedirect(value: string | null): string {
  if (!value) return '/admin'
  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) return value
  try {
    const url = new URL(value)
    if (EXTERNAL_RETURN_ORIGINS.includes(url.origin)) return url.href
  } catch {
    // not a URL
  }
  return '/admin'
}
