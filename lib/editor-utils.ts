export function createDefaultTableContent(rows = 3, cols = 3) {
  return {
    type: 'table',
    content: Array.from({ length: rows }, (_, rowIndex) => ({
      type: 'tableRow',
      content: Array.from({ length: cols }, () => ({
        type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
        content: [{ type: 'paragraph' }],
      })),
    })),
  }
}

export function hasMarkdownTable(text: string): boolean {
  const lines = text.split('\n')
  let pipeLines = 0
  let hasSeparator = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      pipeLines += 1
      if (/^\|[\s:]*-{2,}[\s:]*\|/.test(trimmed)) {
        hasSeparator = true
      }
    }
  }

  return pipeLines >= 3 && hasSeparator
}

const UNICODE_DIAGRAM_CHARS = /[┌┐└┘├┤┬┴┼─│╭╮╰╯╔╗╚╝╠╣╦╩╬═║▲▼▶◀↑↓←→↔↕]/
const ASCII_ARROW = /(?:-->|<--|->|<-|=>|<=)/
const ASCII_DIAGRAM_ONLY = /^[\s|+\-=_<>/\\.`'()[\]{}:]+$/

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0
}

function isAsciiDiagramLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (UNICODE_DIAGRAM_CHARS.test(line) || ASCII_ARROW.test(line)) return true

  const asciiDiagramMarks = countMatches(line, /[|+\-=_<>/\\]/g)
  if (asciiDiagramMarks < 3) return false
  if (countMatches(line, /[|+<>/\\]/g) === 0) return false

  if (ASCII_DIAGRAM_ONLY.test(trimmed)) return true
  return /^[|+]/.test(trimmed) || /[|+]$/.test(trimmed)
}

function isIndentedCodeBlock(lines: string[]) {
  const nonEmpty = lines.filter((line) => line.trim())
  return nonEmpty.length > 0 && nonEmpty.every((line) => /^(?: {4}|\t)/.test(line))
}

function shouldFenceAsciiDiagramBlock(lines: string[]) {
  const nonEmpty = lines.filter((line) => line.trim())
  if (nonEmpty.length < 2) return false
  if (isIndentedCodeBlock(nonEmpty)) return false
  if (hasMarkdownTable(lines.join('\n'))) return false

  const diagramLines = nonEmpty.filter(isAsciiDiagramLine)
  return diagramLines.length >= 2
}

function markdownFenceFor(content: string) {
  const longestBacktickRun = Math.max(
    2,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
  )
  return '`'.repeat(longestBacktickRun + 1)
}

function fenceAsciiDiagramBlock(lines: string[]) {
  const content = lines.join('\n')
  const fence = markdownFenceFor(content)
  return [fence + 'text', content, fence].join('\n')
}

export function protectAsciiFlowchartsInMarkdown(text: string) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let block: string[] = []
  let inFence = false
  let fenceMarker: string | null = null
  let wrappedDiagram = false

  const flushBlock = () => {
    if (block.length === 0) return
    if (shouldFenceAsciiDiagramBlock(block)) {
      output.push(fenceAsciiDiagramBlock(block))
      wrappedDiagram = true
    } else {
      output.push(block.join('\n'))
    }
    block = []
  }

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/)

    if (fenceMatch) {
      if (!inFence) {
        flushBlock()
        inFence = true
        fenceMarker = fenceMatch[1][0]
        output.push(line)
        continue
      }

      if (fenceMarker && fenceMatch[1][0] === fenceMarker) {
        inFence = false
        fenceMarker = null
      }
      output.push(line)
      continue
    }

    if (inFence) {
      output.push(line)
      continue
    }

    if (!line.trim()) {
      flushBlock()
      output.push(line)
      continue
    }

    block.push(line)
  }

  flushBlock()
  return wrappedDiagram ? output.join('\n') : text
}

export function isValidHttpUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

export function normalizeUrl(value: string) {
  return isValidHttpUrl(value) ? value : `https://${value}`
}
