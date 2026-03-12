# claude-max-api-proxy

将 Claude Code CLI（Claude Max 订阅）包装为 **OpenAI 兼容的 HTTP API**，让任何支持 OpenAI 格式的客户端（如 OpenClaw、Cursor、Continue 等）都能直接使用你的 Claude Max 订阅，无需额外付费购买 Anthropic API。

> **说明**：本项目基于 [operand-ai/claude-max-api-proxy](https://github.com/operand-ai/claude-max-api-proxy) fork，包含以下修复和增强：
> - 修复 `[object Object]` 消息乱码 bug（原始 bug：多部分消息内容未正确提取文本）
> - 支持图片（multimodal）输入
> - 支持真正的多轮对话（通过 `--resume` 机制持久化 session 上下文）

---

## 前提条件

1. **Claude Max 订阅**（$100/月的个人版或更高）
2. **Claude Code CLI** 已安装并登录：
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude --version      # 确认已安装
   claude auth login     # 登录你的 Anthropic 账户
   ```
3. **Node.js 18+**

---

## 安装

### 方式一：从本仓库安装（推荐）

```bash
npm install -g github:liuye6666/claude-max-api-proxy
```

### 方式二：从源码安装

```bash
git clone https://github.com/liuye6666/claude-max-api-proxy.git
cd claude-max-api-proxy
npm install
npm run build
npm install -g .
```

---

## 启动代理服务器

```bash
claude-max-api-proxy
```

默认监听 `http://localhost:3456`。

### 可选环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3456` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址（`127.0.0.1` 限制本机访问） |
| `DEFAULT_MODEL` | `claude-sonnet-4` | 未指定模型时的默认模型 |

---

## 可用模型

| 模型 ID | 说明 |
|---------|------|
| `claude-opus-4` | 最强模型，适合复杂任务 |
| `claude-sonnet-4` | 平衡性能与速度（默认） |
| `claude-haiku-4` | 最快，适合简单任务 |

---

## API 端点

### `POST /v1/chat/completions`

标准 OpenAI 聊天补全接口，支持流式（`stream: true`）和非流式。

**多轮对话**：在请求的 `user` 字段中传入一个稳定的会话 ID（如 UUID），代理会自动：
- 首次请求：用 `--session-id` 创建新 Claude session，保存到磁盘
- 后续请求：用 `--resume` 恢复已有 session，只传入最新一条消息

```bash
curl http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "你好，介绍一下自己"}],
    "user": "my-conversation-id-123"
  }'
```

**图片输入**（multimodal）：

```bash
curl http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "这张图里有什么？"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBOR..."}}
      ]
    }]
  }'
```

### `GET /v1/models`

返回可用模型列表。

### `GET /health`

健康检查。

---

## 在 OpenClaw 中使用

### 1. 启动代理服务（或配置为自动启动，见下方）

```bash
claude-max-api-proxy
```

### 2. 配置 OpenClaw 指向代理

```bash
openclaw config set models.providers.claude-max.baseUrl "http://localhost:3456/v1"
openclaw config set models.providers.claude-max.apiKey "dummy"
```

### 3. 切换模型

```bash
# 切换到 Claude Opus 4（最强）
openclaw config set agents.defaults.model.primary "claude-max/claude-opus-4"

# 切换到 Claude Sonnet 4（平衡）
openclaw config set agents.defaults.model.primary "claude-max/claude-sonnet-4"

# 切换到 Claude Haiku 4（最快）
openclaw config set agents.defaults.model.primary "claude-max/claude-haiku-4"

# 恢复使用 GLM-5
openclaw config set agents.defaults.model.primary "zai/glm-5"
```

### 4. 重启 OpenClaw 网关

通过 OpenClaw 菜单栏 App 重启，或：

```bash
scripts/restart-mac.sh
```

---

## 配置为 macOS 后台服务（LaunchAgent）

创建文件 `~/Library/LaunchAgents/com.claude-max-api.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude-max-api</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/node</string>
    <string>/path/to/claude-max-api-proxy/dist/server/standalone.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>/Users/yourname</string>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/claude-max-api.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/claude-max-api.log</string>
</dict>
</plist>
```

替换 `/path/to/node`（用 `which node` 查找）和 `/path/to/claude-max-api-proxy`（用 `npm root -g` 查找），然后：

```bash
launchctl load ~/Library/LaunchAgents/com.claude-max-api.plist
```

---

## 多轮对话工作原理

```
第 1 轮请求 (user: "conv-abc")
  ├─ sessionManager 无记录 → 生成新 UUID: "550e8400-..."
  ├─ 调用 claude --session-id 550e8400-... [完整消息历史]
  ├─ Claude CLI 将 session 保存到 ~/.claude/sessions/550e8400-.../
  └─ sessionManager 记录: conv-abc → 550e8400-...

第 2 轮请求 (user: "conv-abc")
  ├─ sessionManager 找到记录 → resumeId = "550e8400-..."
  ├─ 调用 claude --resume 550e8400-... [仅最新一条 user 消息]
  └─ Claude CLI 从磁盘加载完整上下文，继续对话
```

Session 文件保存在 `~/.claude-max-api-sessions.json`，TTL 为 24 小时。

---

## 注意事项

- 本项目**不是** Anthropic 官方产品，使用时请遵守 [Anthropic 使用政策](https://www.anthropic.com/legal/usage-policy)。
- Claude Code CLI 需要保持登录状态（`claude auth login`）。
- 仅供个人使用，请勿用于商业 API 服务。
- 如果 Claude Code CLI 未登录或 session 过期，代理会返回相应错误。

---

## 许可证

MIT
