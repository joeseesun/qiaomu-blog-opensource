import OpenAI from 'openai'
import { nanoid } from 'nanoid'
import { getAiRuntimeEnv } from '@/lib/ai'
import { resolveAiImageProfileConfig } from '@/lib/ai-image-config'
import type { GeneratedEditorImage } from '@/lib/ai-image'
import {
  extractWorkersAiImageAsset,
  generateEditorImage,
  resolveWorkersAiImageSize,
  runWorkersAiCompatImageRequest,
} from '@/lib/ai-image'
import {
  clampMaxTokens,
  clampTemperature,
  isWorkersAiBaseUrl,
  normalizeBaseUrl,
  resolveAiConfigSecret,
  resolveAiProfileConfig,
} from '@/lib/ai-provider-profiles'
import {
  DEFAULT_IMAGE_WORKERS_MODEL,
  DEFAULT_TEXT_WORKERS_MODEL,
  WORKERS_AI_IMAGE_MODEL_SUGGESTIONS,
  WORKERS_AI_TEXT_MODEL_SUGGESTIONS,
} from '@/lib/ai-post-generator/constants'
import {
  buildPlainRetryInstruction,
  buildFallbackSummary,
  extractGeneratedText,
  getWorkersAiAssistantPayload,
  extractWorkersAiText,
  getExternalAssistantPayload,
  normalizeSummary,
  parseJsonValue,
  shouldRetryAssistantPayload,
} from '@/lib/ai-post-generator/parsers'
import {
  resolveGeneratedSlug,
  resolveGeneratedTags,
} from '@/lib/ai-post-generator/metadata-fallbacks'
import {
  buildAssetUrls,
  buildContextBlock,
  buildCoverPrompt,
  buildTextSystemPrompt,
  getNowPrefix,
  sanitizeFilename,
} from '@/lib/ai-post-generator/prompts'
import { buildTextGenerationRequestOptions } from '@/lib/ai-post-generator/request-options'
import {
  ensureAiPostGeneratorInfrastructure,
  getAiPostGeneratorByTarget,
  listAiPostGenerators,
} from '@/lib/ai-post-generator/storage'
import type {
  AiPostGeneratorRow,
  AiPostGeneratorTarget,
  GeneratePostCoverInput,
  GeneratePostMetadataInput,
} from '@/lib/ai-post-generator/types'

export type {
  AiPostGeneratorProviderMode,
  AiPostGeneratorRow,
  AiPostGeneratorTarget,
  GeneratePostCoverInput,
  GeneratePostMetadataInput,
} from '@/lib/ai-post-generator/types'
export {
  ensureAiPostGeneratorInfrastructure,
  getAiPostGeneratorByTarget,
  listAiPostGenerators,
  WORKERS_AI_IMAGE_MODEL_SUGGESTIONS,
  WORKERS_AI_TEXT_MODEL_SUGGESTIONS,
}

type TextRuntime =
  | {
      strategy: 'workers-ai'
      binding: WorkersAIBinding
      model: string
      temperature: number
      maxTokens: number
    }
  | {
      strategy: 'external-provider'
      apiKey: string
      baseURL: string
      model: string
      temperature: number
      maxTokens: number
    }

function readFlag(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

async function runTextGenerator(
  config: TextRuntime,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  target: Exclude<AiPostGeneratorTarget, 'cover'>,
): Promise<{ text: string; reasoningText: string }> {
  const retryMessages = messages.map((message, index) => (
    index === 0 && message.role === 'system'
      ? {
          ...message,
          content: `${message.content}\n\nDo not output reasoning, thinking, or analysis. Return only the final answer.\n${buildPlainRetryInstruction(target)}`,
        }
      : message
  ))

  if (config.strategy === 'workers-ai') {
    const requestOptions = buildTextGenerationRequestOptions({
      strategy: 'workers-ai',
      model: config.model,
    })
    const result = await config.binding.run(config.model, {
      messages,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      response_format: { type: 'json_object' },
      ...requestOptions,
    })
    const primary = getWorkersAiAssistantPayload(result)
    if (primary.content) {
      return {
        text: primary.content,
        reasoningText: primary.reasoning,
      }
    }

    if (shouldRetryAssistantPayload(primary)) {
      const retry = await config.binding.run(config.model, {
        messages: retryMessages,
        max_tokens: Math.min(Math.max(config.maxTokens * 3, 512), 2048),
        temperature: config.temperature,
      })
      const retryPayload = getWorkersAiAssistantPayload(retry)
      if (retryPayload.content) {
        return {
          text: retryPayload.content,
          reasoningText: retryPayload.reasoning || primary.reasoning,
        }
      }

      return {
        text: extractWorkersAiText(retry),
        reasoningText: retryPayload.reasoning || primary.reasoning,
      }
    }

    return {
      text: extractWorkersAiText(result),
      reasoningText: primary.reasoning,
    }
  }

  if (isWorkersAiBaseUrl(config.baseURL)) {
    const requestOptions = buildTextGenerationRequestOptions({
      strategy: 'external-provider',
      baseURL: config.baseURL,
      model: config.model,
    })
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
          temperature: config.temperature,
          max_tokens: nextMaxTokens,
          ...requestOptions,
        }),
        signal: AbortSignal.timeout(30000),
      })

      const rawBody = await response.text().catch(() => '')
      if (!response.ok) {
        try {
          const parsed = rawBody ? JSON.parse(rawBody) as {
            errors?: Array<{ message?: string }>
            error?: { message?: string } | string
            message?: string
          } : null

          const firstWorkersError = parsed?.errors?.find((item) => typeof item?.message === 'string' && item.message.trim())
          if (firstWorkersError?.message) {
            throw new Error(firstWorkersError.message.trim())
          }
          if (typeof parsed?.error === 'object' && parsed.error?.message) {
            throw new Error(parsed.error.message.trim())
          }
          if (typeof parsed?.error === 'string' && parsed.error.trim()) {
            throw new Error(parsed.error.trim())
          }
          if (typeof parsed?.message === 'string' && parsed.message.trim()) {
            throw new Error(parsed.message.trim())
          }
        } catch (error) {
          if (error instanceof Error) throw error
        }

        throw new Error(rawBody.trim() || `Workers AI 文本生成失败：HTTP ${response.status}`)
      }

      return rawBody ? JSON.parse(rawBody) : null
    }

    const payload = await runCompatRequest(messages, config.maxTokens)
    const primary = getWorkersAiAssistantPayload(payload)
    if (primary.content) {
      return {
        text: primary.content,
        reasoningText: primary.reasoning,
      }
    }

    if (shouldRetryAssistantPayload(primary)) {
      const retryPayload = await runCompatRequest(
        retryMessages,
        Math.min(Math.max(config.maxTokens * 3, 512), 2048),
      )
      const retried = getWorkersAiAssistantPayload(retryPayload)
      if (retried.content) {
        return {
          text: retried.content,
          reasoningText: retried.reasoning || primary.reasoning,
        }
      }

      return {
        text: extractWorkersAiText(retryPayload),
        reasoningText: retried.reasoning || primary.reasoning,
      }
    }

    return {
      text: extractWorkersAiText(payload),
      reasoningText: primary.reasoning,
    }
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  })

  const requestOptions = buildTextGenerationRequestOptions({
    strategy: 'external-provider',
    baseURL: config.baseURL,
    model: config.model,
  })

  const response = await client.chat.completions.create({
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    response_format: { type: 'json_object' },
    ...requestOptions,
  } as never)

  const primary = getExternalAssistantPayload(response)
  if (primary.content) {
    return {
      text: primary.content,
      reasoningText: primary.reasoning,
    }
  }

  if (primary.reasoning || primary.finishReason === 'length') {
    const retry = await client.chat.completions.create({
      model: config.model,
      messages: retryMessages,
      temperature: config.temperature,
      max_tokens: Math.min(Math.max(config.maxTokens * 3, 512), 2048),
      ...requestOptions,
    } as never)

    const retryPayload = getExternalAssistantPayload(retry)
    if (retryPayload.content) {
      return {
        text: retryPayload.content,
        reasoningText: retryPayload.reasoning || primary.reasoning,
      }
    }

    return {
      text: '',
      reasoningText: retryPayload.reasoning || primary.reasoning,
    }
  }

  return {
    text: '',
    reasoningText: primary.reasoning,
  }
}

async function resolveWorkersAiProfile(
  db: D1Database,
  secret: string,
  preferredProfileId?: number,
) {
  const preferredProfile = Number.isFinite(preferredProfileId) && Number(preferredProfileId) > 0
    ? await resolveAiProfileConfig(db, secret, Number(preferredProfileId))
    : null

  if (preferredProfile && (
    preferredProfile.provider === 'workers_ai'
    || isWorkersAiBaseUrl(preferredProfile.base_url)
  )) {
    return preferredProfile
  }

  const row = await db.prepare(`
    SELECT id
    FROM ai_provider_profiles
    WHERE provider = 'workers_ai'
       OR base_url LIKE '%api.cloudflare.com/client/v4/accounts/%/ai/%'
    ORDER BY is_default DESC, updated_at DESC, id DESC
    LIMIT 1
  `).first<{ id: number }>()

  if (!row?.id) return null
  return resolveAiProfileConfig(db, secret, row.id)
}

async function resolveTextRuntime(
  generator: AiPostGeneratorRow,
  env?: Partial<CloudflareEnv> | null,
  db?: D1Database,
): Promise<TextRuntime> {
  const aiEnv = getAiRuntimeEnv(env)
  if (generator.provider_mode === 'workers_ai') {
    if (env?.WORKERS_AI && readFlag(aiEnv.ENABLE_WORKERS_AI)) {
      return {
        strategy: 'workers-ai',
        binding: env.WORKERS_AI,
        model: generator.workers_model || aiEnv.WORKERS_AI_MODEL || DEFAULT_TEXT_WORKERS_MODEL,
        temperature: clampTemperature(generator.temperature),
        maxTokens: clampMaxTokens(generator.max_tokens),
      }
    }

    if (db) {
      const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown> | undefined)
      const selectedWorkersProfile = await resolveWorkersAiProfile(
        db,
        secret,
        Number.isFinite(generator.text_profile_id) ? Number(generator.text_profile_id) : undefined,
      )

      if (selectedWorkersProfile) {
        return {
          strategy: 'external-provider',
          apiKey: selectedWorkersProfile.api_key,
          baseURL: selectedWorkersProfile.base_url,
          model: generator.workers_model || selectedWorkersProfile.model || DEFAULT_TEXT_WORKERS_MODEL,
          temperature: clampTemperature(generator.temperature),
          maxTokens: clampMaxTokens(generator.max_tokens),
        }
      }
    }

    throw new Error('当前部署未启用 Workers AI binding，且未找到可用的 Workers AI provider profile')
  }

  if (!db) {
    throw new Error('文本模型配置缺少数据库上下文')
  }

  const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown> | undefined)
  const profile = await resolveAiProfileConfig(
    db,
    secret,
    Number.isFinite(generator.text_profile_id) ? Number(generator.text_profile_id) : undefined,
  )

  if (!profile) {
    throw new Error('请先在后台配置可用的文本模型')
  }

  return {
    strategy: 'external-provider',
    apiKey: profile.api_key,
    baseURL: profile.base_url,
    model: profile.model,
    temperature: clampTemperature(generator.temperature || profile.temperature),
    maxTokens: clampMaxTokens(generator.max_tokens || profile.max_tokens),
  }
}

export async function generatePostMetadata(
  input: GeneratePostMetadataInput,
) {
  const generator = await getAiPostGeneratorByTarget(input.db, input.target, input.env)
  if (!generator || generator.is_enabled !== 1) {
    throw new Error('当前字段未启用 AI 生成')
  }

  const fallbackSummary = buildFallbackSummary(input.title || '', input.content || '')
  const runtime = await resolveTextRuntime(generator, input.env, input.db)
  const contextBlock = buildContextBlock(input, input.target)
  const generation = await runTextGenerator(runtime, [
    {
      role: 'system',
      content: buildTextSystemPrompt(input.target, generator.prompt),
    },
    {
      role: 'user',
      content: contextBlock,
    },
  ], input.target)
  const resultText = generation.text

  const parsed = parseJsonValue(resultText)

  if (input.target === 'summary') {
    return {
      target: input.target,
      value: normalizeSummary(
        extractGeneratedText(parsed, resultText, ['summary', 'description', 'text', 'content', 'result']),
        fallbackSummary,
      ),
      generator,
    }
  }

  if (input.target === 'tags') {
    return {
      target: input.target,
      value: resolveGeneratedTags({
        title: input.title,
        content: input.content,
        category: input.category,
        description: input.description,
        tags: input.tags,
        currentSlug: input.currentSlug,
        resultText,
        reasoningText: generation.reasoningText,
      }),
      generator,
    }
  }

  return {
    target: input.target,
    value: resolveGeneratedSlug({
      title: input.title,
      content: input.content,
      category: input.category,
      description: input.description,
      tags: input.tags,
      currentSlug: input.currentSlug,
      resultText,
      reasoningText: generation.reasoningText,
    }),
    generator,
  }
}

async function generateWorkersAiCover(
  generator: AiPostGeneratorRow,
  input: GeneratePostCoverInput,
) {
  const prompt = buildCoverPrompt(generator, input)
  const { width, height } = resolveWorkersAiImageSize(generator.aspect_ratio, generator.resolution)

  let rawResult: unknown
  let model = generator.workers_model || DEFAULT_IMAGE_WORKERS_MODEL

  if (input.env?.WORKERS_AI && readFlag(input.env.ENABLE_WORKERS_AI)) {
    rawResult = await input.env.WORKERS_AI.run(model, {
      prompt,
      width,
      height,
    })
  } else {
    const secret = resolveAiConfigSecret(input.env as unknown as Record<string, unknown> | undefined)
    const selectedWorkersProfile = await resolveWorkersAiProfile(input.db, secret)

    if (!selectedWorkersProfile) {
      throw new Error('当前部署未启用 Workers AI binding，且未找到可用的 Workers AI provider profile')
    }

    model = generator.workers_model || selectedWorkersProfile.model || DEFAULT_IMAGE_WORKERS_MODEL
    rawResult = await runWorkersAiCompatImageRequest(
      {
        apiKey: selectedWorkersProfile.api_key,
        baseURL: selectedWorkersProfile.base_url,
        model,
      },
      {
        prompt,
        width,
        height,
      },
    )
  }

  const asset = await extractWorkersAiImageAsset(rawResult, model)
  const alt = (input.title || '文章封面').trim() || '文章封面'
  const { yyyy, mm } = getNowPrefix()
  const baseName = sanitizeFilename(alt).slice(0, 48)
  const key = `image/${yyyy}/${mm}/ai-cover-${nanoid(10)}-${baseName}.${asset.extension}`

  await input.images.put(key, asset.data, {
    httpMetadata: {
      contentType: asset.contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      originalName: `${baseName}.${asset.extension}`,
      source: 'ai-post-cover',
    },
  })

  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const variants = buildAssetUrls(encodedKey, readFlag(input.env?.ENABLE_CF_IMAGE_PIPELINE))

  return {
    key,
    url: `/api/images/${encodedKey}`,
    variants,
    prompt,
    revisedPrompt: prompt,
    alt,
    actionLabel: generator.label,
    aspectRatio: generator.aspect_ratio,
    resolution: generator.resolution,
    size: `${width}x${height}`,
    profileName: 'Workers AI',
    model,
  } satisfies GeneratedEditorImage
}

export async function generatePostCover(
  input: GeneratePostCoverInput,
): Promise<{ generator: AiPostGeneratorRow; image: GeneratedEditorImage }> {
  const generator = await getAiPostGeneratorByTarget(input.db, 'cover', input.env)
  if (!generator || generator.is_enabled !== 1) {
    throw new Error('当前封面生成功能未启用')
  }

  let image: GeneratedEditorImage

  if (generator.provider_mode === 'workers_ai') {
    image = await generateWorkersAiCover(generator, input)
  } else {
    const secret = resolveAiConfigSecret(input.env as unknown as Record<string, unknown> | undefined)
    const profile = await resolveAiImageProfileConfig(
      input.db,
      secret,
      Number.isFinite(generator.image_profile_id) ? Number(generator.image_profile_id) : undefined,
    )

    if (!profile) {
      throw new Error('请先在后台配置可用的图片模型')
    }

    image = await generateEditorImage({
      action: 'custom',
      actionPrompt: generator.prompt,
      actionLabel: generator.label,
      userPrompt: buildContextBlock(input, 'cover'),
      articleTitle: input.title,
      contextText: input.content,
      aspectRatio: generator.aspect_ratio,
      resolution: generator.resolution,
      profileId: profile.id,
      db: input.db,
      env: input.env as unknown as Record<string, string | undefined> | undefined,
      images: input.images,
    })
  }

  return { generator, image }
}
