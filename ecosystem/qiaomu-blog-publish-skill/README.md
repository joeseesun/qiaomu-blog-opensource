# qiaomu-blog-publish Skill

把本地 Markdown / 网页 URL / 粘贴的正文发布到 **Qiaomu Blog**，行为与后台编辑器对齐（图片自动上传到 R2、外链图服务端转存绕防盗链、全 frontmatter 字段支持）。

> 主操作手册在 [`SKILL.md`](./SKILL.md) — 字段契约、接口清单、错误码、与其他工具协作方式都在那里。README 只讲安装。

## 安装

```bash
# 推荐：软链接，改完 SKILL.md 立刻生效，多端共享
ln -s "$(pwd)/ecosystem/qiaomu-blog-publish-skill" \
      "$HOME/.claude/skills/qiaomu-blog-publish"

# 或者拷贝一份
cp -r ecosystem/qiaomu-blog-publish-skill \
      "$HOME/.claude/skills/"
```

最小文件：只要 `SKILL.md` 在 `~/.claude/skills/qiaomu-blog-publish/` 下，Claude Code 就会识别。

## 配置

推荐环境变量（不落盘）：

```bash
export QMBLOG_API_URL="https://blog.qiaomu.ai"
export QMBLOG_API_TOKEN="qm_xxx"
```

或者配置文件（记得 `chmod 600`）：

```bash
cat > ~/.claude/skills/qiaomu-blog-publish/config.json <<'EOF'
{
  "apiUrl": "https://blog.qiaomu.ai",
  "token": "qm_xxx",
  "defaultStatus": "draft",
  "defaultCategory": "未分类"
}
EOF
chmod 600 ~/.claude/skills/qiaomu-blog-publish/config.json
```

Token 在博客后台 `/admin/settings` → **API Token** 里生成。

## 快速用法

```bash
# 交互式
/qiaomu-blog-publish ~/Documents/my-article.md

# 一把发布（适合其他 agent 调）
/qiaomu-blog-publish ~/drafts/foo.md --yes --status=published --category=AI

# 预检不发
/qiaomu-blog-publish ~/drafts/foo.md --dry-run

# 机器可读输出（给 CI / 下游 agent 解析）
/qiaomu-blog-publish ~/drafts/foo.md --yes --json

# 抓网页变草稿
/qiaomu-blog-publish https://example.com/article

# 直接粘贴
/qiaomu-blog-publish
# (粘贴 Markdown 后按 Enter)
```

自然语言也通：

- "把这篇发到博客"
- "发布成草稿"
- "发到 Qiaomu Blog"

## 姊妹工具

同一套后端，三种入口，随手选：

| 入口 | 场景 | 文档 |
|---|---|---|
| **本 skill** | Claude Code / 其他 AI agent / 命令行 | [SKILL.md](./SKILL.md) |
| [`chrome-clipper`](../chrome-clipper/README.md) | 浏览器上网随手存 | |
| [`obsidian-publisher`](../obsidian-publisher/README.md) | Obsidian 笔记一键发 | |
