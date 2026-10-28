import type { D1Database, WorkerEnv } from "./d1";
import { mockJudge } from "./judge";
import { soupById, soups, type Soup } from "./soups";

const HUMAN = "xinxin";
const AI = "azhi";
const PLAYERS = new Set([HUMAN, AI]);
const DEFAULT_ROOM = "haiguitang-main";
type Mode = "easy" | "normal" | "hard";
type Status = "playing" | "won" | "lost" | "ended" | "abandoned";

interface State {
  current_player: string;
  questions_left: Record<string, number | null>;
  hints_used: number;
  hints_total: number;
  revealed_hints: Record<string, unknown>[];
  questions_log: Record<string, unknown>[];
  submissions: Record<string, Record<string, unknown>>;
  soup_bottom_revealed: boolean;
  proactively_revealed: boolean;
  score: number | null;
  score_detail: Record<string, unknown> | null;
  requests: Record<string, { action: string; response: Record<string, unknown> }>;
}

interface Row {
  id: string;
  owner_id: string;
  room_key: string;
  game_id: string;
  mode: Mode;
  status: Status;
  state_json: string;
  start_request_id: string | null;
  active: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export class GameError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
const iso = () => new Date().toISOString();
const clock = () =>
  new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value.trim() : fallback;

function reqId(value: unknown) {
  const id = text(value) || crypto.randomUUID();
  if (id.length > 200) throw new GameError(400, "invalid_request_id", "request_id 过长");
  return id;
}

function room(value: unknown) {
  const key = text(value, DEFAULT_ROOM);
  if (!key || key.length > 160) throw new GameError(400, "invalid_room_key", "room_key 无效");
  return key;
}

function mode(value: unknown): Mode {
  const candidate = text(value, "normal");
  if (candidate !== "easy" && candidate !== "normal" && candidate !== "hard") {
    throw new GameError(400, "invalid_mode", "mode 必须是 easy、normal 或 hard");
  }
  return candidate;
}

function player(value: unknown) {
  const id = text(value);
  if (!PLAYERS.has(id)) throw new GameError(400, "invalid_player", "player 无效");
  return id;
}

function stateOf(row: Row): State {
  try {
    return JSON.parse(row.state_json) as State;
  } catch {
    throw new GameError(500, "invalid_session_state", "游戏状态损坏");
  }
}

function initial(modeName: Mode): State {
  const count = modeName === "easy" ? null : modeName === "normal" ? 6 : 3;
  return {
    current_player: HUMAN,
    questions_left: { [HUMAN]: count, [AI]: count },
    hints_used: 0,
    hints_total: modeName === "hard" ? 0 : 3,
    revealed_hints: [],
    questions_log: [],
    submissions: {},
    soup_bottom_revealed: false,
    proactively_revealed: false,
    score: null,
    score_detail: null,
    requests: {},
  };
}

function safeState(row: Row, state = stateOf(row)): Record<string, unknown> {
  const soup = soupById(row.game_id);
  if (!soup) throw new GameError(500, "missing_soup", "示例题不存在");
  const result: Record<string, unknown> = {
    session_id: row.id,
    room_key: row.room_key,
    status: row.status,
    title: soup.title,
    soup_face: soup.soup_face,
    difficulty: soup.difficulty,
    mode: row.mode,
    current_player: state.current_player,
    questions_left: state.questions_left,
    [`${HUMAN}_questions_left`]: state.questions_left[HUMAN],
    [`${AI}_questions_left`]: state.questions_left[AI],
    hints_used: state.hints_used,
    hints_total: state.hints_total,
    revealed_hints: state.revealed_hints,
    questions_log: state.questions_log,
    submissions: state.submissions,
    score: state.score,
    score_detail: state.score_detail,
    soup_bottom_revealed: state.soup_bottom_revealed,
    proactively_revealed: state.proactively_revealed,
    mock: true,
  };
  if (state.soup_bottom_revealed) result.soup_bottom = soup.soup_bottom;
  return result;
}

async function bodyOf(request: Request) {
  try {
    const value = (await request.json()) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new GameError(400, "invalid_json", "请求 JSON 格式无效");
  }
}

async function session(db: D1Database, owner: string, value: unknown): Promise<Row> {
  const id = text(value);
  if (!id || id.length > 100) throw new GameError(400, "missing_session_id", "缺少 session_id");
  const found = await db
    .prepare("SELECT * FROM game_sessions WHERE id = ? AND owner_id = ? LIMIT 1")
    .bind(id, owner)
    .first<Row>();
  if (!found) throw new GameError(404, "session_not_found", "游戏不存在");
  return found;
}

async function priorStart(db: D1Database, owner: string, id: string) {
  return db
    .prepare("SELECT * FROM game_sessions WHERE owner_id = ? AND start_request_id = ? LIMIT 1")
    .bind(owner, id)
    .first<Row>();
}

function pickSoup(previous?: string) {
  const pool = soups.filter((item) => item.id !== previous);
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return pool[random[0] % pool.length] ?? soups[0];
}

async function start(db: D1Database, owner: string, args: Record<string, unknown>) {
  const selectedMode = mode(args.mode);
  const selectedRoom = room(args.room_key);
  const request = reqId(args.request_id);
  const duplicate = await priorStart(db, owner, request);
  if (duplicate) return { ...safeState(duplicate), duplicate: true, reused: true };

  if (args.force_new !== true && args.reuse_active === true) {
    const active = await db
      .prepare("SELECT * FROM game_sessions WHERE owner_id = ? AND room_key = ? AND active = 1 LIMIT 1")
      .bind(owner, selectedRoom)
      .first<Row>();
    if (active) return { ...safeState(active), reused: true };
  }

  let previousGame: string | undefined;
  if (text(args.previous_session_id)) {
    previousGame = (await session(db, owner, args.previous_session_id)).game_id;
  }
  const soup = pickSoup(previousGame);
  const id = crypto.randomUUID();
  const timestamp = iso();
  const gameState = initial(selectedMode);
  const insert = db
    .prepare("INSERT INTO game_sessions (id, owner_id, room_key, game_id, mode, status, state_json, start_request_id, active, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'playing', ?, ?, 1, 1, ?, ?)")
    .bind(id, owner, selectedRoom, soup.id, selectedMode, JSON.stringify(gameState), request, timestamp, timestamp);
  const reuseWithoutReplacement = args.force_new !== true && args.reuse_active === true;
  try {
    if (reuseWithoutReplacement) {
      // The partial unique index is the concurrency gate: a simultaneous winner
      // keeps the room pointer, and the loser returns that winner below.
      await db.batch([insert]);
    } else {
      await db.batch([
        db
          .prepare("UPDATE game_sessions SET active = 0, updated_at = ? WHERE owner_id = ? AND room_key = ? AND active = 1")
          .bind(timestamp, owner, selectedRoom),
        insert,
      ]);
    }
  } catch {
    const raced = await priorStart(db, owner, request);
    if (raced) return { ...safeState(raced), duplicate: true, reused: true };
    if (reuseWithoutReplacement) {
      const active = await db
        .prepare("SELECT * FROM game_sessions WHERE owner_id = ? AND room_key = ? AND active = 1 LIMIT 1")
        .bind(owner, selectedRoom)
        .first<Row>();
      if (active) return { ...safeState(active), reused: true };
    }
    throw new GameError(409, "start_conflict", "开局发生并发冲突，请用同一 request_id 重试");
  }
  return safeState(
    {
      id,
      owner_id: owner,
      room_key: selectedRoom,
      game_id: soup.id,
      mode: selectedMode,
      status: "playing",
      state_json: JSON.stringify(gameState),
      start_request_id: request,
      active: 1,
      version: 1,
      created_at: timestamp,
      updated_at: timestamp,
    },
    gameState,
  );
}

type Outcome = {
  state: State;
  response: Record<string, unknown>;
  status?: Status;
  active?: 0 | 1;
};

async function mutate(
  db: D1Database,
  owner: string,
  id: unknown,
  action: string,
  request: string,
  operation: (row: Row, state: State, soup: Soup) => Outcome,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const row = await session(db, owner, id);
    const current = stateOf(row);
    const duplicate = current.requests[request];
    if (duplicate) {
      if (duplicate.action !== action) throw new GameError(409, "request_id_reused", "request_id 已用于其他操作");
      return { ...duplicate.response, duplicate: true };
    }
    const soup = soupById(row.game_id);
    if (!soup) throw new GameError(500, "missing_soup", "示例题不存在");
    const outcome = operation(row, current, soup);
    current.requests[request] = { action, response: outcome.response };
    const ids = Object.keys(current.requests);
    ids.slice(0, Math.max(0, ids.length - 100)).forEach((old) => delete current.requests[old]);
    const changed = await db
      .prepare("UPDATE game_sessions SET state_json = ?, status = ?, active = ?, version = version + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?")
      .bind(
        JSON.stringify(outcome.state),
        outcome.status ?? row.status,
        outcome.active ?? row.active,
        iso(),
        row.id,
        owner,
        row.version,
      )
      .run();
    if ((changed.meta?.changes ?? 0) === 1) return outcome.response;
  }
  throw new GameError(409, "concurrent_update", "游戏刚被另一端更新，请重试");
}

async function ask(db: D1Database, owner: string, args: Record<string, unknown>) {
  const actor = player(args.player);
  const question = text(args.question);
  if (!question || question.length > 300) throw new GameError(400, "invalid_question", "问题不能为空且不能超过 300 字");
  const judged = mockJudge.ask(question);
  if (judged.answer === "驳回") return { ...judged, mock: true };
  const request = reqId(args.request_id);
  return mutate(db, owner, args.session_id, "ask", request, (row, current) => {
    if (row.status !== "playing" || current.soup_bottom_revealed) throw new GameError(409, "round_closed", "本局已经结束");
    const left = current.questions_left[actor];
    if (left !== null && left <= 0) throw new GameError(409, "no_questions_left", "本方提问次数已用完");
    if (left !== null) current.questions_left[actor] = left - 1;
    current.current_player = actor === HUMAN ? AI : HUMAN;
    current.questions_log.push({
      type: "question",
      request_id: request,
      player: actor,
      source: text(args.source, "web"),
      question,
      answer: judged.answer,
      time: clock(),
    });
    const response = { ...safeState(row, current), ...judged, mock: true };
    return { state: current, response };
  });
}

async function hint(db: D1Database, owner: string, args: Record<string, unknown>) {
  const actor = player(args.player);
  const request = reqId(args.request_id);
  return mutate(db, owner, args.session_id, "hint", request, (row, current, soup) => {
    if (row.status !== "playing" || current.soup_bottom_revealed) throw new GameError(409, "round_closed", "本局已经结束");
    const index = current.revealed_hints.length;
    if (index >= current.hints_total || !soup.hints[index]) throw new GameError(409, "no_hints_available", "没有可用提示");
    const entry = {
      index: index + 1,
      hint: soup.hints[index],
      text: soup.hints[index],
      player: actor,
      requested_by: actor,
      time: clock(),
    };
    current.revealed_hints.push(entry);
    current.hints_used = current.revealed_hints.length;
    current.questions_log.push({ type: "hint", request_id: request, ...entry });
    const response = { ...safeState(row, current), hint: soup.hints[index], mock: true };
    return { state: current, response };
  });
}

async function submit(db: D1Database, owner: string, args: Record<string, unknown>) {
  const actor = player(args.player);
  const answer = text(args.answer);
  if (!answer || answer.length > 2000) throw new GameError(400, "invalid_answer", "推理不能为空且不能超过 2000 字");
  const mockScore = mockJudge.submit(answer);
  const request = reqId(args.request_id);
  return mutate(db, owner, args.session_id, "submit", request, (row, current) => {
    if (current.submissions[actor]) throw new GameError(409, "already_submitted", "本方已经提交过推理");
    const submission = {
      submitted: true,
      player: actor,
      submitted_answer: answer,
      answer,
      score: mockScore.overall,
      total: mockScore.overall,
      rank: mockScore.rank,
      score_detail: { key_plot: mockScore.key_plot, logic: mockScore.logic, detail: mockScore.detail },
      key_plot: mockScore.key_plot,
      logic: mockScore.logic,
      detail: mockScore.detail,
      comment: mockScore.comment,
      request_id: request,
      submitted_at: clock(),
      mock: true,
    };
    current.submissions[actor] = submission;
    if (row.mode !== "easy") current.questions_left[actor] = 0;
    current.score = mockScore.overall;
    current.score_detail = { ...mockScore };
    current.questions_log.push({
      type: "submit",
      request_id: request,
      player: actor,
      submitted_by: actor,
      submitted_answer: answer,
      text: `已提交完整推理 · Mock ${mockScore.overall} 分 ${mockScore.rank}`,
      time: clock(),
    });
    const response = {
      ...safeState(row, current),
      score: mockScore.overall,
      rank: mockScore.rank,
      detail: { key_plot: mockScore.key_plot, logic: mockScore.logic, detail: mockScore.detail },
      comment: mockScore.comment,
      can_reveal: true,
      mock: true,
    };
    return { state: current, response };
  });
}

async function reveal(db: D1Database, owner: string, args: Record<string, unknown>) {
  const request = reqId(args.request_id);
  return mutate(db, owner, args.session_id, "reveal", request, (row, current) => {
    current.soup_bottom_revealed = true;
    current.proactively_revealed = true;
    const finalStatus: Status = (current.score ?? 0) >= 90 ? "won" : "lost";
    const response = safeState({ ...row, status: finalStatus }, current);
    return { state: current, status: finalStatus, response };
  });
}

async function abandon(db: D1Database, owner: string, args: Record<string, unknown>) {
  const request = reqId(args.request_id);
  return mutate(db, owner, args.session_id, "abandon", request, (_row, current) => ({
    state: current,
    status: "abandoned",
    active: 0,
    response: { abandoned: true, session_id: text(args.session_id), mock: true },
  }));
}

async function activate(db: D1Database, owner: string, args: Record<string, unknown>) {
  const target = await session(db, owner, args.session_id);
  const key = room(args.room_key);
  const timestamp = iso();
  try {
    await db.batch([
      db.prepare("UPDATE game_sessions SET active = 0, updated_at = ? WHERE owner_id = ? AND room_key = ? AND active = 1").bind(timestamp, owner, key),
      db.prepare("UPDATE game_sessions SET room_key = ?, active = 1, version = version + 1, updated_at = ? WHERE id = ? AND owner_id = ?").bind(key, timestamp, target.id, owner),
    ]);
  } catch {
    throw new GameError(409, "activate_conflict", "共享房间正在更新，请重试");
  }
  return { activated: true, session_id: target.id, room_key: key };
}

export function ownerFrom(request: Request) {
  const owner = request.headers.get("oai-authenticated-user-id")?.trim() ?? "";
  if (!owner || owner.length > 512) throw new GameError(401, "unauthorized", "需要 ChatGPT Sites 身份");
  return owner;
}

export async function execute(
  env: WorkerEnv,
  owner: string,
  operation: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!env.DB) throw new GameError(500, "missing_d1_binding", "D1 绑定 DB 不可用");
  if (operation === "health") return { ok: true, service: "haiguitang-sites", mock: true };
  if (operation === "start") return start(env.DB, owner, args);
  if (operation === "ask") return ask(env.DB, owner, args);
  if (operation === "hint") return hint(env.DB, owner, args);
  if (operation === "submit") return submit(env.DB, owner, args);
  if (operation === "reveal") return reveal(env.DB, owner, args);
  if (operation === "abandon") return abandon(env.DB, owner, args);
  if (operation === "activate") return activate(env.DB, owner, args);
  if (operation === "status") return safeState(await session(env.DB, owner, args.session_id));
  if (operation === "active") {
    const key = room(args.room_key);
    const active = await env.DB
      .prepare("SELECT * FROM game_sessions WHERE owner_id = ? AND room_key = ? AND active = 1 LIMIT 1")
      .bind(owner, key)
      .first<Row>();
    return active ? { active: true, ...safeState(active) } : { active: false, message: "no active game in this room" };
  }
  throw new GameError(404, "not_found", "接口不存在");
}

export async function handleGameApi(request: Request, env: WorkerEnv) {
  try {
    const owner = ownerFrom(request);
    const url = new URL(request.url);
    const operation = url.pathname.replace(/^\/api\/game\/?/, "").replace(/\/$/, "");
    const reads = new Set(["health", "active", "status"]);
    const writes = new Set(["start", "ask", "hint", "submit", "reveal", "abandon", "activate"]);
    if (reads.has(operation) && request.method !== "GET") throw new GameError(405, "method_not_allowed", "请求方法不允许");
    if (writes.has(operation) && request.method !== "POST") throw new GameError(405, "method_not_allowed", "请求方法不允许");
    let args: Record<string, unknown> = {};
    if (request.method === "POST") args = await bodyOf(request);
    else url.searchParams.forEach((value, key) => { args[key] = value; });
    return json(await execute(env, owner, operation, args));
  } catch (error) {
    if (error instanceof GameError) return json({ error: error.message, error_code: error.code }, error.status);
    console.error("haiguitang_request_failed", { path: new URL(request.url).pathname });
    return json({ error: "服务暂时不可用", error_code: "internal_error" }, 500);
  }
}
