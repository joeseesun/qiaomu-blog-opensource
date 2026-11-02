// Asks GitHub Actions to rebuild www.qiaomu.ai so a memo shows up within minutes
// instead of at the next hourly build. Optional: without the token it does nothing.
//   npx wrangler secret put WWW_REBUILD_GITHUB_TOKEN   (fine-grained PAT, Contents: read & write on the repo)
const DEFAULT_REPO = 'joeseesun/qiaomu-website'

type RebuildEnv = {
  WWW_REBUILD_GITHUB_TOKEN?: string
  WWW_REBUILD_REPO?: string
}

export async function triggerWwwRebuild(env: RebuildEnv, reason: string) {
  const token = env.WWW_REBUILD_GITHUB_TOKEN
  if (!token) return
  const repo = env.WWW_REBUILD_REPO || DEFAULT_REPO
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'qmblog-memos',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ event_type: 'memos-updated', client_payload: { reason } }),
    })
    if (!response.ok) console.warn('www rebuild dispatch failed:', response.status)
  } catch (error) {
    console.warn('www rebuild dispatch failed:', error)
  }
}
