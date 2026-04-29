---
name: qiaomu-blog-publish
description: 把本地 Markdown / 纯文本 / 网页 URL 发布到 Qiaomu Blog。行为与后台编辑器保持一致：本地图自动上传到 R2、外链图走服务端转存绕过防盗链、支持分类 / 标签 / 摘要 / 封面 / slug / 隐藏 / 密码 / 草稿 / 已发布全部字段。
trigger: /qiaomu-blog-publish
user_invocable: true
---

# qiaomu-blog-publish

把任何 Markdown 或网页内容，以"和后台编辑器一模一样"的效果，发布到你自己的 Qiaomu Blog。

## 🎯 设计原则

- **与后台等价**：skill 调用的发布接口、上传接口、转存接口，和后台编辑器调用的是同一套（`POST /api/posts`、`POST /api/uploads`、`POST /api/uploads/from-url`）。所以浏览器里手工发一篇和 skill 发一篇，数据库里存的字段完全一致。
- **图像自动处理**：本地图片走 `/api/uploads`（multipart），正文里的第三方外链图走 `/api/uploads/from-url`（服务端 fetch，绕 Referer 防盗链）。替换后正文只剩自家 `/api/images/...` 的相对路径。
- **交互/非交互双模**：默认交互式确认（标题/分类/状态），加 `--yes` 可一把发布，适合其他 agent / CI 调用。
- **可复制、可迭代**：整个 skill 就是这一份 Markdown，扔到 `~/.claude/skills/` 下任意 Claude 客户端都能用；任何 agent 可 `cat SKILL.md` 读进 context 复用。

## 🧭 触发方式

### Slash command

```
/qiaomu-blog-publish path/to/article.md
/qiaomu-blog-publish https://example.com/article
/qiaomu-blog-publish                             # 然后粘贴 Markdown
```

### 带标志

```
/qiaomu-blog-publish ~/note.md --status=published --category=AI --yes
/qiaomu-blog-publish ~/note.md --dry-run --json  # 预检不发
/qiaomu-blog-publish ~/note.md --json            # 机器可读输出
```

### 自然语言

- "把这篇发到博客"
- "发布成草稿"
- "发到 Qiaomu Blog"
- "把这个 URL 的文章转成草稿"

## ⚙️ 配置

### 读取顺序（先命中的生效）

1. 命令行 `--api-url=... --token=...`
2. 环境变量 `QMBLOG_API_URL` / `QMBLOG_API_TOKEN`
3. 环境变量 `QMBLOG_API_TOKEN`（兼容旧名）
4. `~/.claude/skills/qiaomu-blog-publish/config.json`

### config.json 示例

```json
{
  "apiUrl": "https://blog.qiaomu.ai",
  "token": "qm_xxxxxxxxxxxxxxxxxxxxxxxxxx",
  "defaultStatus": "draft",
  "defaultCategory": "未分类"
}
```

⚠️ **安全**：这个文件含明文 token，**创建后立刻** `chmod 600`。API URL 必须是 `https://`，否则终止。

### Token 怎么拿

1. 打开博客后台 `/admin/settings`
2. 进入 API Token 页签 → **生成 Token**
3. 复制 `qm_xxx` 形态的 token 值（只显示一次）
4. 粘到 config.json 或 export 成环境变量

## 📋 支持的 frontmatter

skill 把 frontmatter 映射到后端接口字段。**所有字段都可选**。

```yaml
---
title: 文章标题                      # 缺省则取第一条 H1，再缺省取文件名
slug: 2026-04-28-my-article         # 缺省自动生成 YYYY-MM-DD-<nanoid6>
description: 手写摘要                 # 缺省自动从正文前 160 字生成
category: AI                        # 必须是后台已存在的分类名
tags: [AI, 工作流, 自动化]           # 最多 10 个
cover_image: /api/images/xxx.jpg    # 绝对或自家相对路径；留空后端不会自动生成
status: draft                       # draft | published，默认 draft
is_hidden: 0                        # 1 = unlisted（不进列表，只有链接能访问）
password: my-secret                 # 有值 = 加密文章
---
```

### Frontmatter 字段 → 后端字段对照

| frontmatter | API 字段 (`POST /api/posts`) | 备注 |
|---|---|---|
| `title` | `title` | 必须，后端会 trim |
| `slug` | `slug` | 缺省由后端生成，重复则 409 |
| `description` | `description` | 缺省后端走 `buildAutoDescription(content)` |
| `category` | `category` | 字符串，后端找不到会建一个"未分类" |
| `tags` | `tags` | 数组，后端截取前 10 个 |
| `cover_image` | `cover_image` | 字符串 URL |
| `status` | `status` | `draft` 或 `published`，其他值视为 `draft` |
| `is_hidden` | `is_hidden` | `0 / 1` |
| `password` | `password` | 有值 = 加密文章，空字符串等同 null |

正文部分两种互斥提交方式：
- **Markdown 模式**（推荐）：提交 `content` 字段，后端用 `remark + remark-gfm + remark-html` 渲染 HTML
- **HTML 模式**：如果已经有渲染好的 HTML，提交 `html` 字段，后端直接采纳，`content` 仍必填（作全文搜索/回显源）

skill 默认走 Markdown 模式。

## 🔁 完整工作流（对齐后台行为）

### Step 1 · 判断输入

| 输入形态 | 处理 |
|---|---|
| 以 `http://` 或 `https://` 开头 | 用 `curl` / `fetch` 抓 HTML → `turndown` 转 Markdown |
| 以 `/` 或 `./` 开头且文件存在 | 读文件 |
| 其他 | 当作直接粘贴的 Markdown |

非 HTTPS 的目标 URL 要二次确认（防止内网地址或钓鱼）。

### Step 2 · 读配置 + 预检

```bash
# 读配置
API_URL="${QMBLOG_API_URL:-$(jq -r .apiUrl ~/.claude/skills/qiaomu-blog-publish/config.json 2>/dev/null)}"
TOKEN="${QMBLOG_API_TOKEN:-${QMBLOG_API_TOKEN:-$(jq -r .token ~/.claude/skills/qiaomu-blog-publish/config.json 2>/dev/null)}}"

# 预检：URL 必须 https
[[ "$API_URL" =~ ^https:// ]] || { echo "apiUrl 必须是 https://"; exit 1; }

# 预检：token 健康
curl -sf "$API_URL/api/admin/categories" -H "Authorization: Bearer $TOKEN" > /tmp/cats.json || {
  echo "❌ token 无效或无权限（/api/admin/categories 401/403）"
  exit 1
}
```

`/dry-run` 模式到这里就停，打印"将要发布的元信息"让人审阅。

### Step 3 · 解析 frontmatter + 标题推断

优先级：`frontmatter.title` > 正文首个 H1 > 文件名去扩展名。

如果标题来自首个 H1，**要在正文里把那一行 H1 删掉**，避免重复（后台渲染也会加大标题）。

### Step 4 · 处理本地图片（上传到 R2）

正文中识别以下三种引用：

- `![alt](./image.png)`、`![alt](../img.jpg)`、`![alt](/absolute/path.png)`
- `![[image.png]]`（Obsidian wikilink，相对笔记所在目录）
- HTML `<img src="./x.png">`

解析到的**本地文件**用 multipart 上传：

```bash
curl -fsSL -X POST "$API_URL/api/uploads" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$ABS_PATH"
```

响应：

```json
{
  "success": true,
  "key": "image/2026/04/<hash>-<filename>",
  "url": "/api/images/image/2026/04/<hash>-<filename>",
  "type": "image",
  "name": "original.png",
  "size": 123456,
  "deduplicated": false,
  "variants": { "raw": "/api/images/...", "content": "...?w=1600&q=85&format=webp", ... }
}
```

把**正文里的本地引用**替换成 `url`（不是 `variants.content`——文章内部显示原图即可，后台自动做 CF 图片管线转换）。

### Step 5 · 处理外链图片（服务端转存）

正文中识别所有 `https?://` 开头的 img src。**同源（即 `$API_URL` 下的 `/api/images/...`）跳过**。其余外链图调服务端接口，绕 Referer 防盗链：

```bash
curl -fsSL -X POST "$API_URL/api/uploads/from-url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$REMOTE_URL\"}"
```

成功替换 src。单张失败（415/413/502）**不要中断整体发布**，记录到最终报告的 `warnings[]` 让用户手动处理。

> 实现备忘：这个接口和编辑器粘贴钩子调的是同一个，支持 25MB 内的 jpg/png/gif/webp/avif/svg，带 SHA-256 去重。

### Step 6 · 交互确认（非 `--yes` 时）

打印要发布的元信息让用户过一遍：

```
标题：我在 OpenClaw 里搭了五个 Agent
分类：AI（已存在）
标签：AI, 工作流, 自动化
状态：draft
slug：自动生成
封面：（未设置）
隐藏：否
加密：否
图片：本地 3 张 → 已上传；外链 2 张 → 1 张成功 / 1 张失败（cdn.gooo.ai/xxx.jpg 415）

确认发布？[Y/n]
```

`--yes` 模式跳过确认直接发。

### Step 7 · 调用发布接口

```bash
curl -fsSL -X POST "$API_URL/api/posts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @/tmp/payload.json
```

`/tmp/payload.json` 示例（完整 field set）：

```json
{
  "title": "我在 OpenClaw 里搭了五个 Agent",
  "slug": "2026-04-28-five-agents",
  "description": "Cypher、Muse、Forge、Sigma、Vitality——搭了又关掉三个的复盘。",
  "category": "AI",
  "tags": ["AI", "工作流", "自动化"],
  "cover_image": "/api/images/image/2026/04/abc123-cover.jpg",
  "status": "draft",
  "is_hidden": 0,
  "password": null,
  "content": "## 一、从 Claude 到 OpenClaw\n\n用 Claude Code 的时候，我…\n\n![图](/api/images/image/2026/04/xxx.png)\n"
}
```

响应：

```json
{
  "success": true,
  "slug": "2026-04-28-five-agents",
  "id": 42,
  "category": "AI",
  "tags": ["AI", "工作流", "自动化"],
  "description": "Cypher、Muse…",
  "cover_image": "/api/images/image/2026/04/abc123-cover.jpg"
}
```

### Step 8 · 输出结果

**人类模式（默认）**：

```
✅ 发布成功

标题：我在 OpenClaw 里搭了五个 Agent
状态：draft
分类：AI
标签：AI, 工作流, 自动化
slug：2026-04-28-five-agents
Edit：https://blog.qiaomu.ai/editor?edit=2026-04-28-five-agents
View：https://blog.qiaomu.ai/2026-04-28-five-agents
图片：本地 3 张、外链 1 张（成功），外链 1 张失败
```

> ⚠️ Edit URL 格式是 `?edit=<slug>`，不是 `?slug=<slug>`。`View` 是 `/<slug>`，不是 `/posts/<slug>`。

**机器模式（`--json`）**：

```json
{
  "success": true,
  "slug": "2026-04-28-five-agents",
  "id": 42,
  "status": "draft",
  "editUrl": "https://blog.qiaomu.ai/editor?edit=2026-04-28-five-agents",
  "viewUrl": "https://blog.qiaomu.ai/2026-04-28-five-agents",
  "uploads": {
    "localImages": 3,
    "remoteRehosted": 1,
    "remoteFailed": [
      { "src": "https://cdn.gooo.ai/xxx.jpg", "reason": "415" }
    ]
  }
}
```

## 🛡️ 错误处理

| HTTP / 情况 | 含义 | 给用户的提示 |
|---|---|---|
| 无 token | 未配置 | "去 `/admin/settings` 生成 API Token，写到 config.json 或 export" |
| `401` | token 失效 | "Token 失效，重新生成后更新配置" |
| `409` on POST /api/posts | `slug` 重复 | "换个 slug，或用自动生成（删掉 frontmatter 的 slug 字段）" |
| `400` title/content 空 | frontmatter 没标题 + 正文也是空 | "请至少给文章一个标题和一行正文" |
| `413` on /api/uploads | 单文件 > 100MB | "先本地压缩再试" |
| `413` on /api/uploads/from-url | 外链图 > 25MB | "另存为手动上传，或改引用缩略图 URL" |
| `415` on /api/uploads/from-url | 不支持的 MIME | "只支持 jpg/png/gif/webp/avif/svg" |
| `502` on /api/uploads/from-url | 源站拒绝 / 超时 | "源站防爬更严了，要手动存图" |
| `500` | 未知 | 带上 `x-request-id`（若有）给维护者 |

所有错误都保留原文链接 / 本地路径，**不要默默丢**。

## 🤝 与其他 agent / 工具协作

### Claude Code 里让别的 agent 用

任何 agent 在自己 prompt 里读到 `ecosystem/qiaomu-blog-publish-skill/SKILL.md` 就知道字段、接口、错误码。典型调用：

```
Agent X（写完稿子后）→ 触发 /qiaomu-blog-publish ~/drafts/foo.md --yes --status=draft --json
→ 拿到 editUrl，发回用户让他去最后润色
```

### 在 CI / GitHub Actions 里用

```yaml
- name: Publish as draft
  env:
    QMBLOG_API_URL: https://blog.qiaomu.ai
    QMBLOG_API_TOKEN: ${{ secrets.QMBLOG_TOKEN }}
  run: |
    # 这里不走 skill，直接调后端（skill 只是文档；真要 CI 建议抽成独立 npm CLI）
    curl -fsSL -X POST "$QMBLOG_API_URL/api/posts" \
      -H "Authorization: Bearer $QMBLOG_API_TOKEN" \
      -H "Content-Type: application/json" \
      -d @payload.json
```

### 与 chrome-clipper / obsidian-publisher 的关系

三者**共用同一套后端接口**。区别只是入口：

- **chrome-clipper**：浏览器网页剪藏
- **obsidian-publisher**：Obsidian 插件一键发布
- **qiaomu-blog-publish (本 skill)**：命令行 / 任意 AI agent 入口

选哪个看场景。三者都对齐当前文档里的字段契约。

## 📁 必要文件

```
~/.claude/skills/qiaomu-blog-publish/
  SKILL.md              # 本文件
  config.json           # (chmod 600) 可选，apiUrl / token
```

## 🔗 相关接口源码（出问题时直接翻）

| 接口 | 源码位置 |
|---|---|
| `POST /api/posts` | `app/api/posts/route.ts#18` |
| `PATCH /api/posts` | `app/api/posts/route.ts#128`（用于更新已发布文章） |
| `POST /api/uploads` | `app/api/uploads/route.ts` |
| `POST /api/uploads/from-url` | `app/api/uploads/from-url/route.ts` |
| `GET /api/admin/categories` | `app/api/admin/categories/route.ts` |
| Token 鉴权中间件 | `lib/server/route-helpers.ts#ensureAuthenticatedRequest` |

## ❌ 不做的事（防止 skill 无限膨胀）

- ❌ 不管 Markdown 语法校验——后端会渲染，有问题在后台再改
- ❌ 不管 SEO 元信息完备性——后台有 AI 生成器补
- ❌ 不存历史记录 / 不做 undo——这是 D1 里的事
- ❌ 不编辑已发布文章——需要编辑请去 `Edit` URL；真有批量需要，调 `PATCH /api/posts`，skill 里不封装

## 📝 变更日志

- 2026-04-28：重写——对齐后端完整字段、改 Edit/View URL、补错误码表、加 `--yes` / `--json` / `--dry-run`、外链图走 `/api/uploads/from-url`、frontmatter 支持 unlisted/password/tags/cover/slug。
- 2026-04-22（初版）：发布基础功能。
