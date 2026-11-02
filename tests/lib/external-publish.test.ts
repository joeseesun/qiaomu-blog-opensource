import { describe, expect, it } from 'vitest'
import { draftUrl } from '@/lib/external-publish'

describe('draft receipt links', () => {
  it('accepts only HTTPS URLs for the selected platform', () => {
    expect(draftUrl('x', 'https://x.com/i/articles/123')).toBe('https://x.com/i/articles/123')
    expect(draftUrl('zhihu', 'https://zhuanlan.zhihu.com/p/123')).toBe('https://zhuanlan.zhihu.com/p/123')
    for (const url of ['javascript:alert(1)', 'http://x.com/a', 'https://x.com.evil.example/', 'https://user:password@x.com/a', 'https://zhuanlan.zhihu.com/p/1']) expect(draftUrl('x', url)).toBeUndefined()
  })
})
