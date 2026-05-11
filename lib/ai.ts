// AI 服务层 — 支持后台动态配置、Workers AI 与环境变量降级

import OpenAI from 'openai'
import {
  clampMaxTokens,
  clampTemperature,
  decryptApiKey,
  ensureAiConfigInfrastructure,
  isWorkersAiBaseUrl,
  normalizeBaseUrl,
  resolveAiConfigSecret,
} from '@/lib/ai-provider-profiles'
import {
  getExternalAssistantPayload,
  getWorkersAiAssistantPayload,
  shouldRetryAssistantPayload,
} from '@/lib/ai-post-generator/parsers'
import { buildAutoDescription } from '@/lib/post-utils'

const DEFAULT_EXTERNAL_BASE_URL = 'https://api.siliconflow.cn/v1'
const DEFAULT_EXTERNAL_MODEL = 'Qwen/Qwen2.5-7B-Instruct'
const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct'

export interface AIProcessResult {
  category: string
  description: string
  tags: string[]
}

/** Cloudflare Workers env bindings（secrets 不走 process.env） */
export interface AIEnv {
  AI_API_KEY?: string
  AI_BASE_URL?: string
  AI_MODEL?: string
  WORKERS_AI?: WorkersAIBinding
  WORKERS_AI_MODEL?: string
  ENABLE_WORKERS_AI?: string
  AI_CONFIG_ENCRYPTION_SECRET?: string
  ADMIN_TOKEN_SALT?: string
}

type ResolvedConfig =
  | {
      strategy: 'external-provider'
      apiKey: string
      baseURL: string
      model: string
      temperature: number
      maxTokens: number
    }
  | {
      strategy: 'workers-ai'
      binding: WorkersAIBinding
      model: string
      temperature: number
      maxTokens: number
    }
  | {
      strategy: 'disabled'
      reason: string
      model: string
      temperature: number
      maxTokens: number
    }

function readFlag(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function resolveWorkersAiModel(env?: AIEnv): string {
  return (env?.WORKERS_AI_MODEL || env?.AI_MODEL || DEFAULT_WORKERS_AI_MODEL).trim() || DEFAULT_WORKERS_AI_MODEL
}

function getDisabledConfig(reason: string): ResolvedConfig {
  return {
    strategy: 'disabled',
    reason,
    model: '',
    temperature: 0.7,
    maxTokens: 2000,
  }
}

function resolveEnv(env?: AIEnv): ResolvedConfig {
  const externalApiKey = env?.AI_API_KEY || process.env.AI_API_KEY || ''

  if (externalApiKey) {
    return {
      strategy: 'external-provider',
      apiKey: externalApiKey,
      baseURL: env?.AI_BASE_URL || process.env.AI_BASE_URL || DEFAULT_EXTERNAL_BASE_URL,
      model: env?.AI_MODEL || process.env.AI_MODEL || DEFAULT_EXTERNAL_MODEL,
      temperature: 0.7,
      maxTokens: 2000,
    }
  }

  if (env?.WORKERS_AI && readFlag(env?.ENABLE_WORKERS_AI || process.env.ENABLE_WORKERS_AI)) {
    return {
      strategy: 'workers-ai',
      binding: env.WORKERS_AI,
      model: resolveWorkersAiModel(env),
      temperature: 0.7,
      maxTokens: 2000,
    }
  }

  return getDisabledConfig('当前部署未配置 AI 供应商。可配置外部 API Key，或开启 Workers AI。')
}

export function getAiRuntimeEnv(env?: Partial<CloudflareEnv> | null): AIEnv {
  return {
    AI_API_KEY: (env as unknown as Record<string, string | undefined> | null | undefined)?.AI_API_KEY || process.env.AI_API_KEY,
    AI_BASE_URL: (env as unknown as Record<string, string | undefined> | null | undefined)?.AI_BASE_URL || process.env.AI_BASE_URL,
    AI_MODEL: (env as unknown as Record<string, string | undefined> | null | undefined)?.AI_MODEL || process.env.AI_MODEL,
    WORKERS_AI: env?.WORKERS_AI,
    WORKERS_AI_MODEL:
      (env as unknown as Record<string, string | undefined> | null | undefined)?.WORKERS_AI_MODEL ||
      process.env.WORKERS_AI_MODEL,
    ENABLE_WORKERS_AI:
      (env as unknown as Record<string, string | undefined> | null | undefined)?.ENABLE_WORKERS_AI ||
      process.env.ENABLE_WORKERS_AI,
    AI_CONFIG_ENCRYPTION_SECRET:
      (env as unknown as Record<string, string | undefined> | null | undefined)?.AI_CONFIG_ENCRYPTION_SECRET ||
      process.env.AI_CONFIG_ENCRYPTION_SECRET,
    ADMIN_TOKEN_SALT:
      (env as unknown as Record<string, string | undefined> | null | undefined)?.ADMIN_TOKEN_SALT ||
      process.env.ADMIN_TOKEN_SALT,
  }
}

function getClientFromConfig(config: Extract<ResolvedConfig, { strategy: 'external-provider' }>) {
  return new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
}

function extractWorkersAiPayload(result: unknown): unknown {
  if (result && typeof result === 'object') {
    const payload = result as {
      response?: unknown
      result?: { response?: unknown } | unknown
      choices?: Array<{ message?: { content?: unknown } }>
    }

    if (payload.response !== undefined) return payload.response
    if (payload.result && typeof payload.result === 'object' && 'response' in payload.result) {
      return (payload.result as { response?: unknown }).response
    }
    const firstChoice = payload.choices?.[0]?.message?.content
    if (firstChoice !== undefined) return firstChoice
  }

  return result
}

function extractWorkersAiText(result: unknown): string {
  const payload = extractWorkersAiPayload(result)

  if (typeof payload === 'string') return payload.trim()
  if (Array.isArray(payload)) {
    return payload
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text || '')
        }
        return ''
      })
      .join('')
      .trim()
  }
  if (payload && typeof payload === 'object') {
    return JSON.stringify(payload)
  }
  return payload == null ? '' : String(payload).trim()
}

function createTextStream(output: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(output))
      controller.close()
    },
  })
}

async function collectStreamText(
  stream: AsyncIterable<{
    choices?: Array<{
      delta?: {
        content?: string | null
        reasoning_content?: string | null
      }
      finish_reason?: string | null
    }>
  }>,
) {
  let content = ''
  let reasoning = ''
  let finishReason = ''

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]
    const delta = choice?.delta || {}
    if (typeof delta.content === 'string') {
      content += delta.content
    }
    if (typeof delta.reasoning_content === 'string') {
      reasoning += delta.reasoning_content
    }
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason
    }
  }

  return {
    content: content.trim(),
    reasoning: reasoning.trim(),
    finishReason,
  }
}

async function runWorkersAiText(
  config: Extract<ResolvedConfig, { strategy: 'workers-ai' }>,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  response_format?: { type: 'json_object' },
): Promise<string> {
  const result = await config.binding.run(config.model, {
    messages,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    ...(response_format ? { response_format } : {}),
  })

  return extractWorkersAiText(result)
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** 优先读数据库后台配置，环境变量降级 */
export async function resolveConfig(env?: AIEnv, db?: D1Database, profileId?: number): Promise<ResolvedConfig> {
  if (db) {
    try {
      const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown> | undefined)
      await ensureAiConfigInfrastructure(db, secret)

      const selected = Number.isFinite(profileId) && Number(profileId) > 0
        ? await db.prepare(`
            SELECT base_url, model, temperature, max_tokens, api_key_encrypted
            FROM ai_provider_profiles
            WHERE id = ?
            LIMIT 1
          `).bind(Number(profileId)).first<{
            base_url: string
            model: string
            temperature: number
            max_tokens: number
            api_key_encrypted: string
          }>()
        : await db.prepare(`
            SELECT base_url, model, temperature, max_tokens, api_key_encrypted
            FROM ai_provider_profiles
            ORDER BY is_default DESC, id ASC
            LIMIT 1
          `).first<{
            base_url: string
            model: string
            temperature: number
            max_tokens: number
            api_key_encrypted: string
          }>()

      if (selected?.base_url && selected.model) {
        const key = await decryptApiKey(selected.api_key_encrypted || '', secret)
        if (key) {
          return {
            strategy: 'external-provider',
            apiKey: key,
            baseURL: normalizeBaseUrl(selected.base_url),
            model: selected.model,
            temperature: clampTemperature(Number(selected.temperature)),
            maxTokens: clampMaxTokens(Number(selected.max_tokens)),
          }
        }
      }

      const [providerRow, keyRow] = await Promise.all([
        db.prepare("SELECT value FROM site_settings WHERE key = 'ai_provider_config'").first<{ value: string }>(),
        db.prepare("SELECT value FROM site_settings WHERE key = 'ai_provider_api_key'").first<{ value: string }>(),
      ])

      if (providerRow?.value && keyRow?.value) {
        const cfg = JSON.parse(providerRow.value) as {
          base_url?: string
          model?: string
          temperature?: number
          max_tokens?: number
        }

        if (cfg.base_url && cfg.model) {
          return {
            strategy: 'external-provider',
            apiKey: keyRow.value,
            baseURL: normalizeBaseUrl(cfg.base_url),
            model: cfg.model,
            temperature: clampTemperature(Number(cfg.temperature)),
            maxTokens: clampMaxTokens(Number(cfg.max_tokens)),
          }
        }
      }
    } catch {
      // DB 读取失败，降级到环境变量
    }
  }

  return resolveEnv(env)
}

export interface TransformOptions {
  customPrompt?: string
  actionPrompt?: string
  temperature?: number
  profileId?: number
  db?: D1Database
  env?: AIEnv
}

/** 编辑器 AI 操作（支持动态 prompt + custom 自由输入） */
export async function transformEditorSelectionStream(
  text: string,
  action: string,
  options: TransformOptions,
): Promise<ReadableStream<Uint8Array>> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('没有可处理的选中文本')

  const config = await resolveConfig(options.env, options.db, options.profileId)
  if (config.strategy === 'disabled') {
    throw new Error(config.reason)
  }

  let systemPrompt: string
  let temperature: number

  if (action === 'custom') {
    if (!options.customPrompt?.trim()) throw new Error('请输入指令')
    systemPrompt = '你是专业的写作助手。用户给你一段文字和一个处理指令，请严格按指令处理并直接返回结果，不要添加任何说明或解释。'
    temperature = config.temperature
  } else if (options.actionPrompt) {
    systemPrompt = options.actionPrompt
    temperature = options.temperature ?? config.temperature
  } else {
    throw new Error('无效操作')
  }

  const userContent = action === 'custom'
    ? `指令：${options.customPrompt}\n\n文字内容：\n${trimmed}`
    : trimmed

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userContent },
  ]
  const retryMessages = messages.map((message, index) => (
    index === 0
      ? {
          ...message,
          content: `${message.content}\n\nDo not output reasoning, thinking, or analysis. Return only the final answer.`,
        }
      : message
  ))

  if (config.strategy === 'workers-ai') {
    const primaryRaw = await config.binding.run(config.model, {
      messages,
      max_tokens: config.maxTokens,
      temperature,
    })
    const primary = getWorkersAiAssistantPayload(primaryRaw)
    if (primary.content) {
      return createTextStream(primary.content)
    }

    if (shouldRetryAssistantPayload(primary)) {
      const retriedRaw = await config.binding.run(config.model, {
        messages: retryMessages,
        max_tokens: Math.min(Math.max(config.maxTokens * 3, 512), 2048),
        temperature,
      })
      const retried = getWorkersAiAssistantPayload(retriedRaw)
      if (retried.content) {
        return createTextStream(retried.content)
      }
    }

    const output = extractWorkersAiText(primaryRaw)
    return createTextStream(output)
  }

  if (isWorkersAiBaseUrl(config.baseURL)) {
    const runCompatRequest = async (
      nextMessages: Array<{ role: 'system' | 'user'; content: string }>,
      nextMaxTokens: number,
    ) => {
      const response = await fetch(`${normalizeBaseUrl(config.baseURL)}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: nextMessages,
          temperature,
          max_tokens: nextMaxTokens,
        }),
      })

      const rawBody = await response.text().catch(() => '')
      if (!response.ok) {
        throw new Error(rawBody.trim() || `AI 请求失败：HTTP ${response.status}`)
      }

      return rawBody ? JSON.parse(rawBody) : null
    }

    const primaryPayload = await runCompatRequest(messages, config.maxTokens)
    const primary = getWorkersAiAssistantPayload(primaryPayload)
    if (primary.content) {
      return createTextStream(primary.content)
    }

    if (shouldRetryAssistantPayload(primary)) {
      const retryPayload = await runCompatRequest(
        retryMessages,
        Math.min(Math.max(config.maxTokens * 3, 512), 2048),
      )
      const retried = getWorkersAiAssistantPayload(retryPayload)
      if (retried.content) {
        return createTextStream(retried.content)
      }
    }

    return createTextStream(extractWorkersAiText(primaryPayload))
  }

  const client = getClientFromConfig(config)
  const primaryStream = await client.chat.completions.create({
    model: config.model,
    messages,
    temperature,
    max_tokens: config.maxTokens,
    stream: true,
  })
  const primary = await collectStreamText(primaryStream)
  if (primary.content) {
    return createTextStream(primary.content)
  }

  if (shouldRetryAssistantPayload(primary)) {
    const retryStream = await client.chat.completions.create({
      model: config.model,
      messages: retryMessages,
      temperature,
      max_tokens: Math.min(Math.max(config.maxTokens * 3, 512), 2048),
      stream: true,
    })
    const retried = await collectStreamText(retryStream)
    if (retried.content) {
      return createTextStream(retried.content)
    }
  }

  return createTextStream('')
}

export async function processPost(
  title: string,
  content: string,
  env?: AIEnv,
  retries = 2,
  db?: D1Database,
): Promise<AIProcessResult | null> {
  let lastError: Error | null = null
  const resolved = db ? await resolveConfig(env, db) : resolveEnv(env)

  if (resolved.strategy === 'disabled') {
    return null
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [
        {
          role: 'system',
          content: `分析文章，返回 JSON 格式：
{
  "category": "从【技术、生活、读书、思考、旅行】中选择最合适的",
  "description": "生成 120-160 字符的 SEO 描述",
  "tags": ["提取 3-5 个关键标签"]
}`,
        },
        {
          role: 'user',
          content: `标题：${title}\n\n内容：${content.slice(0, 2000)}`,
        },
      ]

      let resultText = ''

      if (resolved.strategy === 'workers-ai') {
        // Workers AI JSON Mode is compatible with `response_format`, but does not support streaming.
        resultText = await runWorkersAiText(
          {
            ...resolved,
            temperature: 0.5,
            maxTokens: Math.min(resolved.maxTokens, 2000),
          },
          messages,
          { type: 'json_object' },
        )
      } else {
        const client = getClientFromConfig(resolved)
        const response = await client.chat.completions.create(
          isWorkersAiBaseUrl(resolved.baseURL)
            ? {
                model: resolved.model,
                messages,
                temperature: 0.5,
                max_tokens: Math.min(resolved.maxTokens, 2000),
              }
            : {
                model: resolved.model,
                messages,
                temperature: 0.5,
                max_tokens: Math.min(resolved.maxTokens, 2000),
                response_format: { type: 'json_object' },
              },
        )

        resultText = getExternalAssistantPayload(response).content || ''
      }

      const result = parseJsonObject(resultText) || {}

      return {
        category: typeof result.category === 'string' && result.category.trim() ? result.category : '技术',
        description:
          typeof result.description === 'string' && result.description.trim()
            ? result.description
            : buildAutoDescription(content),
        tags: Array.isArray(result.tags) ? result.tags.map((item) => String(item)).filter(Boolean) : [],
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.error(`AI processing error (attempt ${attempt + 1}/${retries + 1}):`, lastError)

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
      }
    }
  }

  console.error('AI processing failed after all retries:', lastError)
  return null
}
