# 海龟汤 · ChatGPT Sites 私有全栈 MVP

这是一个面向 ChatGPT Sites 的私有 Vinext / Cloudflare Worker 应用。网页、同源 `/api/game/*` 和无状态 `/mcp` 共用 Sites 注入的 `oai-authenticated-user-id`；游戏 Session 存入 D1，并按 owner 与 `room_key` 隔离。

当前版本仅使用 `samples/sample_soups.json` 中 5 道 `distribution: "public"` 的公开示例汤和固定 Mock 裁判，不调用真实模型、不读取 API Key。页面会持续显示“演示模式 / Mock，不代表真实裁判结果”。

## Sites 结构

```text
.openai/hosting.json             Sites D1（DB）与 MCP capability
app/                             Vinext 响应式前端
worker/index.ts                  Worker 入口及同源路由
worker/game.ts                   身份授权、D1、REST 与 Mock 裁判
worker/judge.ts                  可替换 Judge 接口与当前 Mock 实现
worker/mcp.ts                    MCP 2026-07-28 JSON-RPC
drizzle/0000_sites_sessions.sql  正式 schema migration
samples/sample_soups.json        5 道公开示例题，仅 Worker 导入
server/                          原 Python 实现，保留作参考
```

`dist/`、`node_modules/`、`.wrangler/`、`.vinext/`、`.sites-runtime/`、本地 `.env*` 和运行数据均被忽略。仓库不包含 Sites 项目 ID、Cloudflare 账号配置、真实 Secret 或会话数据。

## 身份与数据边界

- `/api/game/*` 与 `POST /mcp` 都拒绝缺少 Sites 身份头的请求（401）。
- owner ID 只从 `oai-authenticated-user-id` 读取，REST body 和 MCP 参数均不能覆盖。
- Session 查询同时约束 `id + owner_id`；其他 owner 猜中 ID 仍返回 404。
- 浏览器使用 `xinxin`，MCP 使用 `azhi`，二者在相同 owner 与 `room_key` 下共享一局。
- 汤底与 key elements 不进入客户端模块；公开状态仅在 reveal 后返回汤底，刷新可恢复。
- 变更以 `version` 条件更新和有限重试实现乐观并发控制；最近 100 个 `request_id` 的结果与状态在同一原子更新中持久化。

## D1 schema

`game_sessions` 保存 Session ID、owner ID、room key、公开题目 ID、模式、状态、JSON 局面、开局幂等键、活跃指针、版本号以及创建/更新时间。JSON 局面包含双方剩余次数、公开问答、已解锁提示、双方提交与评分、主动揭底标志和请求幂等结果。

唯一索引保证同一 owner 的开局 `request_id` 唯一、同一 owner / room 只有一个 active Session。Migration 只建 schema，不混入种子数据。

## REST

所有路径以 `/api/game` 为前缀：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 身份保护的服务状态 |
| `GET` | `/active?room_key=...` | owner 房间当前局 |
| `POST` | `/start` | 复用或创建新局 |
| `GET` | `/status?session_id=...` | 恢复公开局面 |
| `POST` | `/ask` | Mock 回答并记录时间线 |
| `POST` | `/hint` | 解锁下一条提示 |
| `POST` | `/submit` | 保存推理与固定 Mock 评分 |
| `POST` | `/reveal` | 主动揭底并持久化 |
| `POST` | `/activate` | 将一局设为房间当前局 |
| `POST` | `/abandon` | 放弃并移除 active 指针 |

Mock 回答规则：包含“外星”返回“无关”，包含“一部分”返回“部分相关”，包含“无法判断”返回“驳回”，其他问题返回“是”。提交固定为合法的 72 分，并明确标注 Mock。

## Sites MCP

`POST /mcp` 实现 JSON-RPC `server/discover`、`tools/list`、`tools/call`，协议版本为 `2026-07-28`。工具包括：

- `haiguitang_current`
- `haiguitang_start`
- `haiguitang_status`
- `haiguitang_ask`
- `haiguitang_hint`
- `haiguitang_submit`
- `haiguitang_reveal`
- `haiguitang_next`

改变状态的调用返回协作刹车字段并要求回到对话。提示、提交、揭底和下一题的 schema 强制 `confirmed: true`，用于表达已获得人类明确同意。工具参数不包含 owner ID。

## 本地验证

要求 Node.js `>=22.13.0`：

```bash
npm ci
npm test
```

测试包含 ESLint、原前端状态回归、Vinext 生产构建、渲染测试及构建后 Worker 的 REST / MCP 集成测试。集成测试使用 Node SQLite 提供本地 Mock D1 binding，并真实应用 migration。

本分支不执行 `wrangler deploy`，不需要 Cloudflare 账号配置，也不发布 Site。

## 保留的 Python 参考实现

`server/` 下原 Python JSON 后端、provider-agnostic judge 与独立 FastMCP 均保留。它们可按 `.env.example` 作为历史参考在本地运行，但不是 Sites 构建路径，也不会被 Worker 调用。

## 许可证

- 代码：MIT
- 示例题：CC BY 4.0（见 `CONTENT_LICENSE.md`）
