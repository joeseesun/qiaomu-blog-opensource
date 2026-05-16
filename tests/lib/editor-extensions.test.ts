import { Selection, TextSelection, NodeSelection } from '@tiptap/pm/state'
import { Schema } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { shouldShowEditorBubble } from '@/lib/editor-bubble'
import {
  createDefaultTableContent,
  hasMarkdownTable,
  normalizeUrl,
  protectAsciiFlowchartsInMarkdown,
} from '@/lib/editor-utils'

describe('editor-extensions helpers', () => {
  it('creates a default table with header row and paragraph cells', () => {
    const table = createDefaultTableContent(2, 2)

    expect(table).toEqual({
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph' }] },
            { type: 'tableHeader', content: [{ type: 'paragraph' }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph' }] },
            { type: 'tableCell', content: [{ type: 'paragraph' }] },
          ],
        },
      ],
    })
  })

  it('detects markdown tables but ignores ordinary pipe text', () => {
    expect(hasMarkdownTable('| 列1 | 列2 |\n| --- | --- |\n| 值1 | 值2 |')).toBe(true)
    expect(hasMarkdownTable('普通文本 | 只是一个竖线，不是表格')).toBe(false)
  })

  it('wraps pasted unfenced Unicode flowcharts in text code fences', () => {
    const input = [
      '## 8. 整体数据流',
      '',
      '工程师在 payments/ 启动任务',
      '│',
      '▼',
      '┌──────────────────────┐',
      '│ 加载根 CLAUDE.md      │',
      '└──────────┬───────────┘',
      '',
      '后面的正文继续作为普通段落。',
    ].join('\n')

    expect(protectAsciiFlowchartsInMarkdown(input)).toBe([
      '## 8. 整体数据流',
      '',
      '```text',
      '工程师在 payments/ 启动任务',
      '│',
      '▼',
      '┌──────────────────────┐',
      '│ 加载根 CLAUDE.md      │',
      '└──────────┬───────────┘',
      '```',
      '',
      '后面的正文继续作为普通段落。',
    ].join('\n'))
  })

  it('leaves existing fenced flowcharts and ordinary prose untouched', () => {
    const fenced = [
      '```text',
      '┌────┐',
      '│ OK │',
      '└────┘',
      '```',
      '',
      '普通文本 | 只是一个竖线，不是表格',
    ].join('\n')

    expect(protectAsciiFlowchartsInMarkdown(fenced)).toBe(fenced)
  })

  it('does not treat frontmatter dividers as ASCII diagrams', () => {
    const markdown = [
      '---',
      'title: Claude Code 学习笔记',
      '---',
      '',
      '正文第一段。',
    ].join('\n')

    expect(protectAsciiFlowchartsInMarkdown(markdown)).toBe(markdown)
  })

  it('wraps ASCII box diagrams without touching markdown tables', () => {
    expect(protectAsciiFlowchartsInMarkdown([
      '+---------+',
      '| Build   |',
      '+----+----+',
      '     |',
      '     v',
    ].join('\n'))).toBe([
      '```text',
      '+---------+',
      '| Build   |',
      '+----+----+',
      '     |',
      '     v',
      '```',
    ].join('\n'))

    const table = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    expect(protectAsciiFlowchartsInMarkdown(table)).toBe(table)
  })

  it('normalizes URLs by preserving http(s) links and prefixing bare domains', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
    expect(normalizeUrl('example.com/path')).toBe('https://example.com/path')
  })

  it('shows the bubble menu only for editable text selections, not image node selections', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: {
          group: 'block',
          content: 'text*',
          toDOM: () => ['p', 0],
        },
        image: {
          group: 'block',
          inline: false,
          attrs: { src: {} },
          selectable: true,
          toDOM: (node) => ['img', { src: node.attrs.src }],
        },
        text: { group: 'inline' },
      },
    })

    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('hello world')]),
      schema.node('image', { src: '/demo.png' }),
    ])

    const textSelection = TextSelection.create(doc, 1, 6)
    const imageSelection = NodeSelection.create(doc, 13)
    const cursorSelection = Selection.near(doc.resolve(1))

    expect(shouldShowEditorBubble(textSelection, true)).toBe(true)
    expect(shouldShowEditorBubble(imageSelection, true)).toBe(false)
    expect(shouldShowEditorBubble(cursorSelection, true)).toBe(false)
    expect(shouldShowEditorBubble(textSelection, false)).toBe(false)
  })
})
