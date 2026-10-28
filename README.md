# 共猜 · 海龟汤双人协作

一个可在本地运行的“人类 + AI”海龟汤协作游戏。浏览器前端和 MCP 玩家共享同一套 REST 接口；裁判可连接 OpenAI、DeepSeek 或其他兼容 OpenAI Chat Completions 的模型服务。

仓库不包含真实密钥或私有题库。没有私有题库时，后端自动使用 `samples/sample_soups.json` 中的 5 道公开示例题；运行数据默认写入已被 Git 忽略的项目本地 `data/`。

## 目录

```text
frontend/                   浏览器前端（React / Vinext）
server/turtlesoup_server.py 多线程 REST 后端
server/turtlesoup_mcp.py    MCP 玩家服务
server/judge.py             无状态、服务商无关的裁判模块
server/tests/               不访问真实模型服务的自动化测试
samples/                    5 道公开示例题
schemas/                    题库 JSON Schema
data/                       本地会话、归档和可选私有题库（Git 忽略）
```

## 快速开始

要求：Python 3.10+、Node.js 22.13+。REST 后端只使用 Python 标准库；MCP 服务需要安装 `server/requirements.txt`。

```bash
cp .env.example .env
set -a
. ./.env
set +a
python3 server/turtlesoup_server.py
```

默认 REST 地址是 `http://127.0.0.1:8777`。另开终端启动前端：

```bash
cd frontend
cp .env.example .env.local
npm ci
npm run dev
```

要让 AI 通过 MCP 加入，再开一个终端：

```bash
python3 -m pip install -r server/requirements.txt
python3 server/turtlesoup_mcp.py
```

默认 MCP 地址是 `http://127.0.0.1:8778/`。默认 host 都只监听回环地址，适合本地开发；需要对外提供服务时，应显式修改 host，并在前面配置认证、TLS 和访问控制。

## 配置

所有设置均可通过环境变量覆盖；`.env.example` 只有空密钥和安全的本地默认值。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `TURTLE_DATA_DIR` | `<项目>/data` | 会话及归档的默认目录 |
| `SOUP_DATA_PATH` | `<data>/private/soups.json` | 私有题库；不存在或为空时使用 5 道示例题 |
| `SESSION_DATA_PATH` | `<data>/sessions.json` | 会话文件 |
| `ARCHIVE_DATA_PATH` | `<data>/played_games.json` | 已玩题目归档 |
| `REST_HOST` / `REST_PORT` | `127.0.0.1` / `8777` | REST 监听地址 |
| `MCP_HOST` / `MCP_PORT` | `127.0.0.1` / `8778` | MCP 监听地址 |
| `MCP_REST_API_URL` | `http://127.0.0.1:8777` | MCP 访问的 REST 根地址 |
| `TURTLE_ROOM_KEY` | `haiguitang-main` | MCP 默认房间 key |
| `AI_PLAYER_ID` | `azhi` | REST 与 MCP 共用的 AI 玩家 ID（两个进程须设为相同值） |
| `MCP_SOURCE` | `haiguitang-mcp` | MCP 请求来源标记 |
| `NEXT_PUBLIC_TURTLE_API_BASE` | `http://127.0.0.1:8777`（示例） | 浏览器访问的 REST 根地址 |
| `NEXT_PUBLIC_TURTLE_ROOM_KEY` | `haiguitang-main` | 浏览器默认房间 key |
| `NEXT_PUBLIC_TURTLE_AI_PLAYER_ID` | `azhi` | 浏览器使用的 AI 玩家 ID，应与后端一致 |
| `NEXT_PUBLIC_TURTLE_SOURCE` | `standalone-web` | 浏览器请求来源标记 |

兼容旧变量 `TURTLE_PORT`（REST 端口）和 `GAME_API_URL`（MCP 的 REST 地址），新部署应使用表中的变量。

### 自定义题库

题库是符合 `schemas/soup.schema.json` 的 JSON 数组。推荐放在 `data/private/soups.json`，或者用 `SOUP_DATA_PATH` 指向其他受保护位置。`data/` 已被 `.gitignore` 排除；不要把无再发布授权的题目、汤底或评分要素提交到仓库。

## 通用裁判配置

裁判每次 `/ask` 和 `/submit` 都创建一次独立的 Chat Completions 请求。请求只有当前题目所需的汤底、判定或评分规则，以及本次问题或提交；不会携带玩家模型历史、之前的问答或其他裁判会话。

```env
JUDGE_API_URL=https://你的兼容服务/v1/chat/completions
JUDGE_API_KEY=由服务商提供的密钥
JUDGE_MODEL=服务商支持的模型名
JUDGE_TIMEOUT_SECONDS=30
```

以上 URL、模型名只是说明格式，不是仓库默认配置。密钥缺失时，`/ask` 和 `/submit` 返回明确的 `not_configured` 错误，不会猜答案或生成固定分数。

DeepSeek 旧配置仍兼容，但已弃用：

```env
DEEPSEEK_API_URL=https://api.deepseek.com/v1/chat/completions
DEEPSEEK_API_KEY=由服务商提供的密钥
```

仅设置旧的 `DEEPSEEK_API_KEY` 时，兼容层使用 DeepSeek Chat Completions 地址和 `deepseek-chat`；建议迁移到 `JUDGE_API_URL`、`JUDGE_API_KEY`、`JUDGE_MODEL`。`JUDGE_*` 的优先级更高。

ChatGPT Plus 是 ChatGPT 产品订阅，不包含模型 API 额度。OpenAI、DeepSeek 或其他服务商的模型 API 都由对应 API 账户单独开通、授权和计费。

## 裁判输出与隐私边界

- `/ask` 只接受并返回 `是`、`否`、`无关`、`部分相关`、`驳回` 之一。
- `/submit` 要求四项 0–100 整数评分和合法等级；缺字段、越界或异常 JSON 都视为错误。玩家看到的简短评语由本地按等级生成，不转发服务商说明。
- 服务商原始响应、额外字段、错误正文、裁判提示词和评分要素不会直接返回给玩家，也不会写入日志。
- 配置缺失、超时、服务商错误和格式异常使用净化后的错误码与说明；失败不会扣提问次数、保存提交或伪造结果。
- `/submit` 只返回评分，不自动公开汤底。
- 只有明确调用 `/reveal` 才会持久化 `soup_bottom_revealed=true` 并返回汤底；之后 `/status` 会继续返回汤底，以便刷新恢复结算页。
- MCP 的揭底工具说明要求 AI 先取得人类玩家明确同意；工具不会在提交后自动调用揭底。

会话文件本身包含主持游戏必需的汤底与评分要素，应按私密数据保护。生产环境建议把 `data/` 放到访问受限的持久卷，并限制 REST/MCP 的网络访问。

## REST 与 MCP 接口约定

现有前端与 MCP 使用这些接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 健康检查 |
| `GET` | `/active?room_key=...` | 查询房间当前 Session |
| `POST` | `/start` | 复用活跃局或创建新局 |
| `GET` | `/status?session_id=...` | 获取可恢复的公开局面 |
| `POST` | `/ask` | 提交问题 |
| `POST` | `/hint` | 获取并持久化下一条提示 |
| `POST` | `/submit` | 提交推理并评分 |
| `POST` | `/reveal` | 玩家主动揭底 |
| `POST` | `/activate` | 更新房间指针 |
| `POST` | `/abandon` | 放弃当前局，不揭底 |

REST 服务使用线程服务器处理本地并发请求；JSON 文件通过进程内锁和原子替换写入。高流量、多进程或多主机部署应换用具有事务能力的数据库。

## 测试

后端测试使用内存 stub 和本机临时 HTTP 服务，不访问真实模型服务：

```bash
python3 -m unittest discover -s server/tests -v
python3 -m py_compile server/judge.py server/turtlesoup_server.py server/turtlesoup_mcp.py
```

前端完整测试：

```bash
cd frontend
npm ci
npm test
```

构建脚本通过 `bash` 调用校验脚本，因此不依赖归档、挂载或 Windows 检出后是否保留 Unix 可执行位。

## 许可证

- 代码：MIT
- 示例题：CC BY 4.0（见 `CONTENT_LICENSE.md`）
- 私有题库：不随仓库分发，权利归各自权利人
