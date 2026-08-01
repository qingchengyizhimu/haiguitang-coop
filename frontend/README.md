# 海龟汤 · 人机共游开源前端

一个独立于 Orbis 的网页版海龟汤前端。人类玩家在浏览器操作，AI 通过 MCP 调用同一套后端；双方以 `room_key + session_id` 共享题目、提问、提示、提交和结算。

本仓库只包含独立前端，不包含 Orbis 的源码、Supabase 配置、登录逻辑、私有数据、平台专用工程标识或任何模型密钥，可直接作为单独仓库公开。

## 已实现

- 轻松 / 正常 / 困难三种模式
- 规则页、难度选择、手动加入 Session、复制 Session ID
- 网页与 MCP 共享问答时间线
- 提问、阶梯提示、正式提交、三维评分、可选揭示汤底
- 运行时设置 API 地址、房间 key、玩家 ID 和显示名
- 刷新后恢复正在进行的游戏和完整结算
- 自动寻找由网页或 MCP 开始的新局
- MCP 开出下一题时，旧局结算保持不动，等待人类手动进入
- 后端不可用时可进入有明确标识的本地演示模式
- 手机、平板、桌面响应式布局与键盘可访问弹窗

## 这版专门处理的同步问题

1. **同房间唯一游戏**：`/start` 使用 `room_key` 与 `reuse_active`，不会让网页和 MCP 各起一局。
2. **刷新不丢局面**：浏览器缓存 `session_id` 与规范化后的完整状态；重新打开后先向 `/status` 校准。
3. **请求幂等**：`/ask`、`/hint`、`/submit`、`/reveal` 都发送 `request_id`；失败重试复用同一个 ID。
4. **按钮加锁**：网络请求进行中禁止重复点击，避免同一问题或提示被提交两次。
5. **玩家来源明确**：网页请求发送 `player` 与 `source: "standalone-web"`，MCP 应发送自己的玩家 ID 与来源。
6. **提示内容持久化**：`revealed_hints` 是提示次数与内容的同一份事实源，并兼容多种旧字段名。
7. **提交完整持久化**：从 `submissions[player]` 恢复提交原文、评分、维度、评语、时间和 `request_id`。
8. **重复提交拦截**：前端和后端都应以玩家为单位只允许一次正式提交。
9. **结算停留**：胜负或揭底后锁定当前 Session；即使共享房间已有下一题，也只显示“待进入”。
10. **不强制滚页**：轮询只更新数据，不切换页面、不调用页面滚动；共同记录只在用户本来位于列表底部时跟随新消息。
11. **先查旧局再查新局**：每次轮询先拉当前 `/status`，确认是否结算，再查询 `/active`，避免新房间指针抢走评分页。
12. **放弃与结束分开**：放弃不评分不揭底；结束本局进入结算，仍由玩家手动决定何时抽下一题。
13. **旧响应不倒退状态**：同一 Session 已结算、已揭底或已扣除的次数，不会被较晚到达的旧轮询响应复原。

## 快速开始

要求 Node.js `>= 22.13.0`。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

默认访问同源 API：

```env
NEXT_PUBLIC_TURTLE_API_BASE=/api/game
NEXT_PUBLIC_TURTLE_ROOM_KEY=haiguitang-main
```

也可以不重新构建，在页面右上角的设置中直接修改 API 地址与房间 key。运行时设置只保存在当前浏览器。

## 构建与运行

```bash
npm run build
npm run start
```

构建产物位于 `dist/`。本项目基于 React 19、Vinext 与 Vite，可部署到 Cloudflare Workers，也可以在 VPS 上由 Node/Worker 运行时启动。压缩包不包含 `node_modules`；首次使用必须先运行 `npm ci`。

如果网页是 HTTPS，后端也必须使用 HTTPS，或由同一域名反向代理 `/api/game/*`；浏览器会阻止 HTTPS 页面直连 HTTP API。

## 后端 API 约定

默认 API 根路径为 `/api/game`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/active?room_key=...` | 查询共享房间当前 Session |
| `POST` | `/start` | 复用活跃局或创建新局 |
| `GET` | `/status?session_id=...` | 获取完整、可恢复的共同局面 |
| `POST` | `/activate` | 手动加入后更新共享房间指针 |
| `POST` | `/ask` | 提问；驳回不扣次数 |
| `POST` | `/hint` | 取下一层提示并持久化内容 |
| `POST` | `/submit` | 保存原文并评分；同玩家只允许一次 |
| `POST` | `/reveal` | 揭示汤底并结束本局 |
| `POST` | `/abandon` | 双方放弃，不评分、不揭底 |

### `/start`

请求：

```json
{
  "mode": "normal",
  "room_key": "haiguitang-main",
  "reuse_active": true,
  "force_new": false,
  "player": "xinxin",
  "source": "standalone-web",
  "request_id": "uuid"
}
```

后端应在事务或锁内执行“检查房间活跃局 → 创建 Session → 更新房间指针”。`reuse_active=true` 时若房间已有 `playing` 会话，必须返回原会话。只有玩家在结算页明确抽取下一题时，前端才会发送 `force_new=true`。

### `/ask`

```json
{
  "session_id": 21,
  "player": "xinxin",
  "source": "standalone-web",
  "request_id": "uuid",
  "question": "这个人之前认识店主吗？"
}
```

正常回答：

```json
{
  "answer": "是",
  "xinxin_questions_left": 5,
  "azhi_questions_left": 6
}
```

驳回：

```json
{
  "answer": "驳回",
  "reason": "请改成可以用是或否回答的问题。",
  "xinxin_questions_left": 6,
  "azhi_questions_left": 6
}
```

`request_id` 必须具有幂等性。相同 Session 中收到相同 ID 时返回第一次的结果，不重复扣次数、不重复写日志。

### `/hint`

```json
{
  "session_id": 21,
  "player": "xinxin",
  "source": "standalone-web",
  "request_id": "uuid"
}
```

响应必须同时保存并返回提示内容：

```json
{
  "hint": "先注意那盏灯是给谁看的。",
  "hints_used": 1,
  "hints_total": 3,
  "revealed_hints": [
    {
      "index": 1,
      "hint": "先注意那盏灯是给谁看的。",
      "requested_by": "xinxin",
      "time": "20:15"
    }
  ]
}
```

`hints_used` 应由已保存的 `revealed_hints` 数组长度推导，不能分别维护两份会漂移的计数。

### `/submit`

```json
{
  "session_id": 21,
  "player": "xinxin",
  "source": "standalone-web",
  "request_id": "uuid",
  "answer": "玩家提交的完整推理……"
}
```

响应示例：

```json
{
  "score": 82,
  "rank": "基本还原",
  "score_detail": {
    "key_plot": 85,
    "logic": 80,
    "detail": 78,
    "overall": 82,
    "rank": "基本还原",
    "comment": "关键方向正确，仍缺少一个细节。"
  },
  "submissions": {
    "xinxin": {
      "submitted_answer": "玩家提交的完整推理……",
      "score": 82,
      "rank": "基本还原",
      "score_detail": {
        "key_plot": 85,
        "logic": 80,
        "detail": 78,
        "overall": 82
      },
      "comment": "关键方向正确，仍缺少一个细节。",
      "request_id": "uuid",
      "submitted_at": "20:20"
    }
  }
}
```

提交必须先落库，再返回评分。若评分模型暂时失败，可重试一次；仍失败时返回可重试错误，不要伪造固定分数，也不要把会话标记为已提交。若同一玩家已提交，应返回 `409` 与 `already_submitted`，并附上已有结果或允许前端重新拉 `/status`。

### `/status`

这是网页刷新、MCP 复盘和双方同步的唯一完整真相源。至少返回：

```json
{
  "session_id": 21,
  "status": "playing",
  "title": "题名",
  "soup_face": "汤面",
  "difficulty": "中等",
  "mode": "normal",
  "xinxin_questions_left": 4,
  "azhi_questions_left": 5,
  "hints_used": 1,
  "hints_total": 3,
  "revealed_hints": [
    {
      "index": 1,
      "hint": "先注意那盏灯是给谁看的。",
      "requested_by": "xinxin",
      "time": "20:15"
    }
  ],
  "questions_log": [],
  "submissions": {},
  "soup_bottom_revealed": false
}
```

通用后端也可以改用：

```json
{
  "questions_left": {
    "xinxin": 4,
    "azhi": 5
  }
}
```

前端同时兼容通用字段和 `xinxin_questions_left / azhi_questions_left` 旧字段。

汤底只允许在 `soup_bottom_revealed=true` 后随 `/status` 返回。不要在 `/start`、网页源码或公开题库接口中泄露汤底与评分关键点。

## MCP 侧建议流程

AI 不应每次进入游戏都直接调用 `start`：

1. 调 `current_game(room_key)`，对应 `/active`。
2. 有活跃 Session：直接使用该 ID 调 `status / ask / hint / submit`。
3. 没有活跃 Session 且双方决定开局：再调 `start(mode, room_key, reuse_active=true)`。
4. AI 在结算后想准备下一题，可以显式调用 `start(force_new=true)`；网页会显示“下一题已就绪”，但不会自动离开旧结算。

建议 MCP 请求统一包含：

```json
{
  "player": "azhi",
  "source": "rikkahub-mcp",
  "request_id": "uuid"
}
```

网页默认玩家 ID 为 `xinxin`，AI 默认 ID 为 `azhi`，均可在设置中修改。两端的 `room_key` 必须完全一致。

## 状态与本地缓存

本项目使用以下浏览器键：

- `haiguitang_open_config_v1`
- `haiguitang_open_session_v1`
- `haiguitang_open_state_v1`
- `haiguitang_open_mode_v1`
- `haiguitang_open_settlement_v1`
- `haiguitang_open_left_sessions_v1`

缓存用于断网展示和刷新恢复；后端 `/status` 仍是最终真相源。结束局的结算锁会阻止 `/active` 中的新 Session 自动覆盖评分页。

## 安全边界

- 模型 API 密钥只能放在后端环境变量。
- 汤底、关键情节要素和题库管理接口不能暴露给浏览器。
- 后端应校验 Session、玩家 ID、输入长度和允许的状态迁移。
- 正式部署应启用 HTTPS、限制 CORS 来源并进行速率限制。
- 日志中不要记录模型密钥、鉴权头或未揭示的汤底。

## 验证

```bash
npm run lint
npm test
npm run validate:artifact
```

建议接真实后端至少跑一轮：网页开局 → MCP 加入 → 双方提问 → 双方提示 → 网页提交 → 刷新恢复 → MCP 开下一题 → 网页停留结算 → 手动进入下一题。

## License

[MIT](./LICENSE)
