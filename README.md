# 共猜 · 海龟汤双人协作

一个让「人类 + AI」一起猜海龟汤的开源前端。

- 两人（一人一机）轮流通过是非提问推进推理
- 支持提示、提交推理、自动评分、揭底
- 纯语言、强互动、低门槛

## 目录结构

```
haiguitang/
├─ frontend/                 # 独立前端（Next.js）
├─ server/                   # 后端程序（Python，可公开部分）
├─ samples/
│  └─ sample_soups.json      # 原创示例题（可随仓库分发）
├─ schemas/
│  └─ soup.schema.json       # 题库格式规范
├─ LICENSE                   # 代码 MIT
├─ CONTENT_LICENSE.md        # 示例题许可证
├─ CONTRIBUTING.md
└─ README.md
```

## 快速开始（Windows）

1. 解压 `haiguitang-coop-web-v1.0.0.zip`
2. 安装 Node.js 22 或更高版本
3. 在解压后的文件夹打开 PowerShell，依次运行：

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

4. 打开终端显示的网址，通常是 `http://localhost:5173`

没有后端时会进入本地演示模式。要和 AI 通过 MCP 共玩，在 `.env.local` 填写后端地址：

```env
NEXT_PUBLIC_TURTLE_API_BASE=https://你的域名/api/game
NEXT_PUBLIC_TURTLE_ROOM_KEY=haiguitang-main
```

## 题库说明

本项目默认**不**随代码仓库分发完整题库。

- 完整题库（含汤底、评分要素）只放在后端私有目录：`data/private/soups.json`
- 仓库内仅提供 `samples/sample_soups.json`（原创示例题，5道）
- 玩家在游戏中只能通过接口获得：题名、汤面、难度、已解锁提示、揭底后的汤底
- 汤底和评分要素永不进前端、不进 public 目录、不打印在日志

### 自定义题库

1. 按 `schemas/soup.schema.json` 的格式整理 JSON
2. 放入后端 `data/private/` 目录
3. 通过环境变量指定路径：

```env
SOUP_DATA_PATH=/opt/turtlesoup/data/private/soups.json
```

4. 后端启动时只输出统计（`Loaded 137 soups`），不打印内容

> 版权提醒：没有明确再发布授权的素材，只能作为私人题库使用，不要上传到公开仓库，也不要自行添加开放许可证。

## 许可证

- 代码：MIT
- 示例题：CC BY 4.0
- 私人题库：不随仓库分发，权利归原作者
