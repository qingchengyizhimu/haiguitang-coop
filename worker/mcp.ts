import type { WorkerEnv } from "./d1";
import { execute, ownerFrom } from "./game";

const VERSION = "2026-07-28";
const DEFAULT_ROOM = "haiguitang-main";
const NOTICE =
  "一次只进行一个改变状态的操作；调用后回到对话与人类讨论。提示、提交、揭底和下一题必须先得到人类明确同意。";

type RpcId = string | number | null;
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const sessionId = { type: "string", description: "Session ID" };
const roomKey = { type: "string", default: DEFAULT_ROOM, maxLength: 160 };
const confirmed = {
  type: "boolean",
  const: true,
  description: "仅在人类已明确同意本次操作后传 true",
};

export const MCP_TOOLS = [
  {
    name: "haiguitang_current",
    description: `读取当前共享房间，不改变状态。${NOTICE}`,
    inputSchema: objectSchema({ room_key: roomKey }),
  },
  {
    name: "haiguitang_start",
    description: `开始或恢复一局；完成后停止工具调用并回到对话。${NOTICE}`,
    inputSchema: objectSchema({
      mode: { type: "string", enum: ["easy", "normal", "hard"], default: "normal" },
      room_key: roomKey,
    }),
  },
  {
    name: "haiguitang_status",
    description: `读取一局的共享状态，不改变状态。${NOTICE}`,
    inputSchema: objectSchema({ session_id: sessionId }, ["session_id"]),
  },
  {
    name: "haiguitang_ask",
    description: "问一个问题；一次只问一个，拿到回答后立即回到对话讨论，不得连续调用。",
    inputSchema: objectSchema(
      { session_id: sessionId, question: { type: "string", minLength: 1, maxLength: 300 } },
      ["session_id", "question"],
    ),
  },
  {
    name: "haiguitang_hint",
    description: "获取一条提示。必须先得到人类明确同意；调用后立即回到对话讨论。",
    inputSchema: objectSchema({ session_id: sessionId, confirmed }, ["session_id", "confirmed"]),
  },
  {
    name: "haiguitang_submit",
    description: "提交最终推理并获得 Mock 固定评分。必须先得到人类明确同意；调用后停止。",
    inputSchema: objectSchema(
      {
        session_id: sessionId,
        answer: { type: "string", minLength: 1, maxLength: 2000 },
        confirmed,
      },
      ["session_id", "answer", "confirmed"],
    ),
  },
  {
    name: "haiguitang_reveal",
    description: "主动揭示汤底并结束本局。必须先得到人类明确同意；调用后停止。",
    inputSchema: objectSchema({ session_id: sessionId, confirmed }, ["session_id", "confirmed"]),
  },
  {
    name: "haiguitang_next",
    description: "开始下一题。必须先得到人类明确同意；调用后停止。",
    inputSchema: objectSchema(
      {
        previous_session_id: sessionId,
        mode: { type: "string", enum: ["easy", "normal", "hard"], default: "normal" },
        room_key: roomKey,
        confirmed,
      },
      ["confirmed"],
    ),
  },
] as const;

const toolError = (message: string) => ({
  content: [{ type: "text", text: JSON.stringify({ error: message }) }],
  isError: true,
});

function withBrake(payload: Record<string, unknown>, instruction: string) {
  return {
    ...payload,
    ai_only_instruction: instruction,
    next_action: "WAIT_FOR_HUMAN",
    must_stop_this_turn: true,
  };
}

async function callTool(
  env: WorkerEnv,
  owner: string,
  name: string,
  args: Record<string, unknown>,
) {
  const consentRequired = new Set([
    "haiguitang_hint",
    "haiguitang_submit",
    "haiguitang_reveal",
    "haiguitang_next",
  ]);
  if (consentRequired.has(name) && args.confirmed !== true) {
    return toolError("此操作必须先获得人类明确同意，并传入 confirmed=true");
  }
  const common = {
    ...args,
    player: "azhi",
    source: "sites-mcp",
    request_id: crypto.randomUUID(),
  };
  let payload: Record<string, unknown>;
  let instruction = "操作已完成。停止工具调用，向人类复述结果并讨论下一步。";
  if (name === "haiguitang_current") {
    payload = await execute(env, owner, "active", args);
  } else if (name === "haiguitang_status") {
    payload = await execute(env, owner, "status", args);
  } else if (name === "haiguitang_start") {
    payload = await execute(env, owner, "start", {
      ...common,
      room_key: args.room_key ?? DEFAULT_ROOM,
      reuse_active: true,
      force_new: false,
    });
  } else if (name === "haiguitang_ask") {
    payload = await execute(env, owner, "ask", common);
    instruction = payload.answer === "驳回"
      ? "问题被驳回。停止工具调用，告诉人类原因并一起改写；不要连续重试。"
      : "停止工具调用，向人类复述问题和回答，说出一句当前判断并邀请讨论。";
  } else if (name === "haiguitang_hint") {
    payload = await execute(env, owner, "hint", common);
  } else if (name === "haiguitang_submit") {
    payload = await execute(env, owner, "submit", common);
  } else if (name === "haiguitang_reveal") {
    payload = await execute(env, owner, "reveal", common);
  } else if (name === "haiguitang_next") {
    payload = await execute(env, owner, "start", {
      ...common,
      previous_session_id: args.previous_session_id,
      room_key: args.room_key ?? DEFAULT_ROOM,
      reuse_active: false,
      force_new: true,
    });
  } else {
    return toolError("未知工具");
  }
  const readOnly = name === "haiguitang_current" || name === "haiguitang_status";
  const result = readOnly ? { ...payload, _ai_play_notice: NOTICE } : withBrake(payload, instruction);
  return { content: [{ type: "text", text: JSON.stringify(result) }], isError: false };
}

const rpc = (id: RpcId, result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const rpcError = (id: RpcId, code: number, message: string, status = 200) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function handleMcp(request: Request, env: WorkerEnv) {
  let id: RpcId = null;
  try {
    const owner = ownerFrom(request);
    if (request.method !== "POST") return rpcError(id, -32600, "POST required", 405);
    let input: Record<string, unknown>;
    try {
      input = (await request.json()) as Record<string, unknown>;
    } catch {
      return rpcError(id, -32700, "Parse error", 400);
    }
    id = (input.id as RpcId) ?? null;
    if (input.jsonrpc !== "2.0" || typeof input.method !== "string") {
      return rpcError(id, -32600, "Invalid Request", 400);
    }
    if (input.method === "server/discover") {
      return rpc(id, {
        protocolVersion: VERSION,
        supportedVersions: [VERSION],
        serverInfo: { name: "haiguitang-sites", version: "1.0.0" },
        instructions: NOTICE,
        capabilities: { tools: {} },
      });
    }
    if (input.method === "tools/list") return rpc(id, { tools: MCP_TOOLS });
    if (input.method === "tools/call") {
      const params = (input.params ?? {}) as Record<string, unknown>;
      const args = params.arguments && typeof params.arguments === "object"
        ? (params.arguments as Record<string, unknown>)
        : {};
      try {
        return rpc(id, await callTool(env, owner, String(params.name ?? ""), args));
      } catch (error) {
        return rpc(id, toolError(error instanceof Error ? error.message : "工具调用失败"));
      }
    }
    return rpcError(id, -32601, "Method not found");
  } catch (error) {
    const unauthorized = error instanceof Error && error.message.includes("Sites 身份");
    return rpcError(id, unauthorized ? -32001 : -32603, unauthorized ? "Unauthorized" : "Internal error", unauthorized ? 401 : 500);
  }
}
