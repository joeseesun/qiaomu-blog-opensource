import {
  DEFAULT_GENERATORS,
  LEGACY_PROMPT_VARIANTS,
} from '@/lib/ai-post-generator/constants'
import type { AiPostGeneratorRow, AiPostGeneratorTarget } from '@/lib/ai-post-generator/types'
import {
  clampMaxTokens,
  clampTemperature,
  ensureAiConfigInfrastructure,
  ensureDefaultProfileId,
  resolveAiConfigSecret,
} from '@/lib/ai-provider-profiles'
import {
  ensureAiImageConfigInfrastructure,
  ensureDefaultImageProfileId,
} from '@/lib/ai-image-config'
import {
  normalizeAiImageAspectRatio,
  normalizeAiImageResolution,
} from '@/lib/ai-image-options'

function normalizeGeneratorRow(row: AiPostGeneratorRow): AiPostGeneratorRow {
  return {
    ...row,
    provider_mode: row.provider_mode === 'profile' ? 'profile' : 'workers_ai',
    workers_model: (row.workers_model || '').trim(),
    temperature: clampTemperature(Number(row.temperature)),
    max_tokens: clampMaxTokens(Number(row.max_tokens)),
    aspect_ratio: normalizeAiImageAspectRatio(row.aspect_ratio),
    resolution: normalizeAiImageResolution(row.resolution),
  }
}

async function ensureAiPostGeneratorsTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS ai_post_generators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_key TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      description TEXT NOT NULL,
      prompt TEXT NOT NULL,
      provider_mode TEXT NOT NULL DEFAULT 'workers_ai',
      text_profile_id INTEGER,
      image_profile_id INTEGER,
      workers_model TEXT NOT NULL DEFAULT '',
      temperature REAL NOT NULL DEFAULT 0.7,
      max_tokens INTEGER NOT NULL DEFAULT 2000,
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      resolution TEXT NOT NULL DEFAULT '2k',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_builtin INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `).run()

  const tableInfo = await db.prepare('PRAGMA table_info(ai_post_generators)').all<{ name: string }>()
  const columns = new Set((tableInfo.results || []).map((item) => item.name))

  if (!columns.has('provider_mode')) {
    await db.prepare("ALTER TABLE ai_post_generators ADD COLUMN provider_mode TEXT NOT NULL DEFAULT 'workers_ai'").run()
  }
  if (!columns.has('text_profile_id')) {
    await db.prepare('ALTER TABLE ai_post_generators ADD COLUMN text_profile_id INTEGER').run()
  }
  if (!columns.has('image_profile_id')) {
    await db.prepare('ALTER TABLE ai_post_generators ADD COLUMN image_profile_id INTEGER').run()
  }
  if (!columns.has('workers_model')) {
    await db.prepare("ALTER TABLE ai_post_generators ADD COLUMN workers_model TEXT NOT NULL DEFAULT ''").run()
  }
  if (!columns.has('temperature')) {
    await db.prepare("ALTER TABLE ai_post_generators ADD COLUMN temperature REAL NOT NULL DEFAULT 0.7").run()
  }
  if (!columns.has('max_tokens')) {
    await db.prepare("ALTER TABLE ai_post_generators ADD COLUMN max_tokens INTEGER NOT NULL DEFAULT 2000").run()
  }
  if (!columns.has('aspect_ratio')) {
    await db.prepare("ALTER TABLE ai_post_generators ADD COLUMN aspect_ratio TEXT NOT NULL DEFAULT '16:9'").run()
  }
  if (!columns.has('resolution')) {
    await db.prepare("ALTER TABLE ai_post_generators ADD COLUMN resolution TEXT NOT NULL DEFAULT '2k'").run()
  }
  if (!columns.has('is_enabled')) {
    await db.prepare("ALTER TABLE ai_post_generators ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1").run()
  }
  if (!columns.has('is_builtin')) {
    await db.prepare("ALTER TABLE ai_post_generators ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 1").run()
  }

  for (const seed of DEFAULT_GENERATORS) {
    const existing = await db.prepare(`
      SELECT id, prompt, is_builtin
      FROM ai_post_generators
      WHERE target_key = ?
      LIMIT 1
    `).bind(seed.target_key).first<{ id: number; prompt: string; is_builtin: number }>()

    if (existing?.id) {
      const shouldSyncBuiltinPrompt = existing.is_builtin === 1 && (
        !existing.prompt?.trim()
        || (LEGACY_PROMPT_VARIANTS[seed.target_key] || []).includes(existing.prompt)
      )

      await db.prepare(`
        UPDATE ai_post_generators
        SET label = COALESCE(NULLIF(label, ''), ?),
            description = COALESCE(NULLIF(description, ''), ?),
            prompt = ?,
            workers_model = COALESCE(NULLIF(workers_model, ''), ?),
            provider_mode = COALESCE(NULLIF(provider_mode, ''), ?),
            aspect_ratio = COALESCE(NULLIF(aspect_ratio, ''), ?),
            resolution = COALESCE(NULLIF(resolution, ''), ?),
            temperature = CASE WHEN temperature IS NULL OR temperature <= 0 THEN ? ELSE temperature END,
            max_tokens = CASE WHEN max_tokens IS NULL OR max_tokens <= 0 THEN ? ELSE max_tokens END,
            is_enabled = COALESCE(is_enabled, 1),
            is_builtin = COALESCE(is_builtin, 1),
            updated_at = strftime('%s', 'now')
        WHERE id = ?
      `).bind(
        seed.label,
        seed.description,
        shouldSyncBuiltinPrompt ? seed.prompt : existing.prompt,
        seed.workers_model,
        seed.provider_mode,
        seed.aspect_ratio,
        seed.resolution,
        seed.temperature,
        seed.max_tokens,
        existing.id,
      ).run()
      continue
    }

    await db.prepare(`
      INSERT INTO ai_post_generators (
        target_key, label, description, prompt, provider_mode,
        text_profile_id, image_profile_id, workers_model, temperature, max_tokens,
        aspect_ratio, resolution, is_enabled, is_builtin, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
    `).bind(
      seed.target_key,
      seed.label,
      seed.description,
      seed.prompt,
      seed.provider_mode,
      seed.text_profile_id,
      seed.image_profile_id,
      seed.workers_model,
      seed.temperature,
      seed.max_tokens,
      seed.aspect_ratio,
      seed.resolution,
      seed.is_enabled,
      seed.is_builtin,
    ).run()
  }
}

export async function ensureAiPostGeneratorInfrastructure(
  db: D1Database,
  env?: Partial<CloudflareEnv> | null,
) {
  const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown> | undefined)
  await ensureAiConfigInfrastructure(db, secret)
  await ensureAiImageConfigInfrastructure(db)
  await ensureAiPostGeneratorsTable(db)

  const [defaultTextProfileId, defaultImageProfileId] = await Promise.all([
    ensureDefaultProfileId(db),
    ensureDefaultImageProfileId(db),
  ])

  if (defaultTextProfileId) {
    await db.prepare(`
      UPDATE ai_post_generators
      SET text_profile_id = ?
      WHERE target_key IN ('summary', 'tags', 'slug') AND text_profile_id IS NULL
    `).bind(defaultTextProfileId).run()
  }

  if (defaultImageProfileId) {
    await db.prepare(`
      UPDATE ai_post_generators
      SET image_profile_id = ?
      WHERE target_key = 'cover' AND image_profile_id IS NULL
    `).bind(defaultImageProfileId).run()
  }
}

export async function listAiPostGenerators(
  db: D1Database,
  env?: Partial<CloudflareEnv> | null,
) {
  await ensureAiPostGeneratorInfrastructure(db, env)

  const { results } = await db.prepare(`
    SELECT *
    FROM ai_post_generators
    ORDER BY CASE target_key
      WHEN 'summary' THEN 1
      WHEN 'tags' THEN 2
      WHEN 'slug' THEN 3
      WHEN 'cover' THEN 4
      ELSE 99
    END ASC
  `).all<AiPostGeneratorRow>()

  return (results || []).map(normalizeGeneratorRow)
}

export async function getAiPostGeneratorByTarget(
  db: D1Database,
  target: AiPostGeneratorTarget,
  env?: Partial<CloudflareEnv> | null,
) {
  await ensureAiPostGeneratorInfrastructure(db, env)
  const row = await db.prepare(`
    SELECT *
    FROM ai_post_generators
    WHERE target_key = ?
    LIMIT 1
  `).bind(target).first<AiPostGeneratorRow>()

  return row ? normalizeGeneratorRow(row) : null
}
