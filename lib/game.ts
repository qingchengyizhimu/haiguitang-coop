export type GameMode = "easy" | "normal" | "hard";

export type GameStatus = "playing" | "won" | "lost" | "draw" | string;

export interface GameLog {
  type?: "question" | "hint" | "submit" | "system" | "answer" | string;
  request_id?: string;
  player?: string;
  submitted_by?: string;
  source?: string;
  question?: string;
  answer?: string;
  hint?: string;
  text?: string;
  time?: string;
  submitted_answer?: string;
  [key: string]: unknown;
}

export interface RevealedHint {
  index: number;
  text: string;
  player?: string;
  time?: string;
}

export interface Submission {
  submitted: true;
  player: string;
  total: number;
  rank: string;
  key_plot: number;
  logic: number;
  detail: number;
  comment: string;
  answer: string;
  request_id?: string;
  submitted_at?: string;
  [key: string]: unknown;
}

export interface GameState {
  session_id: string | number;
  status: GameStatus;
  title: string;
  soup_face: string;
  soup_bottom?: string;
  soup_bottom_revealed: boolean;
  difficulty: string;
  mode: GameMode;
  current_player?: string;
  questions_left: Record<string, number | null>;
  hints_used: number;
  hints_total: number | null;
  revealed_hints: RevealedHint[];
  questions_log: GameLog[];
  submissions: Record<string, Submission>;
  room_key?: string;
  [key: string]: unknown;
}

export interface PlayerConfig {
  humanId: string;
  aiId: string;
}

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

const finite = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const text = (value: unknown) => (value == null ? "" : String(value));

export const createRequestId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `haiguitang-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const modeNames: Record<GameMode, string> = {
  easy: "轻松",
  normal: "正常",
  hard: "困难",
};

export const rankFromScore = (score: number) =>
  score >= 90
    ? "完全还原"
    : score >= 70
      ? "基本还原"
      : score >= 50
        ? "部分还原"
        : "方向错误";

export const isRoundClosed = (state?: GameState | null) =>
  Boolean(
    state &&
      (state.status !== "playing" || state.soup_bottom_revealed === true),
  );

export function hintText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const valueRecord = record(value);
  return text(
    valueRecord.hint ??
      valueRecord.hint_content ??
      valueRecord.hint_text ??
      valueRecord.content ??
      valueRecord.text,
  ).trim();
}

function collectHints(data: UnknownRecord, previous?: GameState): RevealedHint[] {
  const result: RevealedHint[] = [];
  const seen = new Set<string>();
  const append = (value: unknown, fallbackIndex?: number) => {
    const content = hintText(value);
    if (!content || seen.has(content)) return;
    const valueRecord = record(value);
    seen.add(content);
    result.push({
      index: finite(
        valueRecord.index ??
          valueRecord.level ??
          valueRecord.hint_index ??
          fallbackIndex,
        result.length + 1,
      ),
      text: content,
      player: text(valueRecord.player ?? valueRecord.requested_by),
      time: text(valueRecord.time ?? valueRecord.created_at),
    });
  };

  previous?.revealed_hints.forEach((item, index) => append(item, index + 1));
  [
    data.revealed_hints,
    data.hints_log,
    data.hint_history,
    data.used_hints,
  ].forEach((list) => {
    if (Array.isArray(list)) {
      list.forEach((item, index) => append(item, index + 1));
    }
  });
  [
    data.hint,
    data.hint_content,
    data.hint_text,
    data.latest_hint,
    data.current_hint,
  ].forEach((item) => append(item));
  return result;
}

export function normalizeSubmission(
  raw: unknown,
  player: string,
  previous?: Submission,
): Submission | null {
  if (raw == null || raw === false) return null;
  const rawRecord = raw === true ? {} : record(raw);
  const scoreRecord = record(rawRecord.score);
  const detailRecord = record(
    rawRecord.score_detail ??
      rawRecord.detail_breakdown ??
      (typeof rawRecord.detail === "object" ? rawRecord.detail : undefined) ??
      scoreRecord.detail,
  );
  const total = finite(
    rawRecord.total ??
      (typeof rawRecord.score === "number" ? rawRecord.score : undefined) ??
      rawRecord.overall ??
      scoreRecord.total ??
      scoreRecord.overall,
    previous?.total ?? 0,
  );
  return {
    ...previous,
    ...rawRecord,
    submitted: true,
    player: text(rawRecord.player ?? rawRecord.submitted_by ?? player),
    total,
    rank: text(rawRecord.rank ?? scoreRecord.rank ?? previous?.rank) ||
      rankFromScore(total),
    key_plot: finite(
      rawRecord.key_plot ?? detailRecord.key_plot ?? scoreRecord.key_plot,
      previous?.key_plot ?? 0,
    ),
    logic: finite(
      rawRecord.logic ?? detailRecord.logic ?? scoreRecord.logic,
      previous?.logic ?? 0,
    ),
    detail: finite(
      (typeof rawRecord.detail === "number" ? rawRecord.detail : undefined) ??
        detailRecord.detail ??
        scoreRecord.detail,
      previous?.detail ?? 0,
    ),
    comment: text(
      rawRecord.comment ?? scoreRecord.comment ?? previous?.comment,
    ),
    answer: text(
      rawRecord.submitted_answer ??
        rawRecord.answer_text ??
        rawRecord.answer ??
        previous?.answer,
    ),
    request_id: text(rawRecord.request_id ?? previous?.request_id) || undefined,
    submitted_at:
      text(rawRecord.submitted_at ?? rawRecord.time ?? previous?.submitted_at) ||
      undefined,
  };
}

function collectSubmissions(
  data: UnknownRecord,
  previous?: GameState,
): Record<string, Submission> {
  const result: Record<string, Submission> = {};
  const append = (player: string, value: unknown) => {
    if (!player) return;
    const normalized = normalizeSubmission(value, player, result[player]);
    if (normalized) result[player] = normalized;
  };

  Object.entries(previous?.submissions ?? {}).forEach(([player, value]) =>
    append(player, value),
  );
  if (Array.isArray(data.submissions)) {
    data.submissions.forEach((value) => {
      const valueRecord = record(value);
      append(text(valueRecord.player ?? valueRecord.submitted_by), value);
    });
  } else {
    Object.entries(record(data.submissions)).forEach(([player, value]) =>
      append(player, value),
    );
  }

  const nested = record(data.submission ?? data.last_submission);
  const flatPlayer = text(data.submitted_by ?? nested.player);
  const hasFlat = Boolean(
    flatPlayer &&
      (data.submitted === true ||
        data.submitted_answer != null ||
        data.score != null ||
        data.score_detail != null),
  );
  if (hasFlat) {
    append(flatPlayer, {
      submitted_by: flatPlayer,
      submitted_answer: data.submitted_answer,
      score: data.score,
      score_detail: data.score_detail ?? data.detail,
      rank: data.rank,
      comment: data.comment,
      request_id: data.request_id,
    });
  }
  return result;
}

const inferredLogType = (item: GameLog) =>
  item.type ||
  (item.hint
    ? "hint"
    : item.question
      ? "question"
      : item.submitted_answer
        ? "submit"
        : "system");

export const logSignature = (item: GameLog) =>
  item.request_id ||
  [
    inferredLogType(item),
    item.player || item.submitted_by || "",
    item.question || item.hint || item.text || item.submitted_answer || "",
    item.answer || "",
  ].join("|");

function mergeLogs(
  data: UnknownRecord,
  previous: GameState | undefined,
  hints: RevealedHint[],
  submissions: Record<string, Submission>,
): GameLog[] {
  const incoming = Array.isArray(data.questions_log)
    ? (data.questions_log as GameLog[])
    : [];
  const kept = previous?.questions_log ?? [];
  const result: GameLog[] = [];
  const known = new Set<string>();
  const append = (item: GameLog) => {
    const key = logSignature(item);
    if (known.has(key)) return;
    known.add(key);
    result.push(item);
  };

  incoming.forEach(append);
  kept.forEach(append);

  const hintTexts = new Set(
    result
      .filter((item) => inferredLogType(item) === "hint")
      .map((item) => hintText(item)),
  );
  hints.forEach((item) => {
    if (hintTexts.has(item.text)) return;
    append({
      type: "hint",
      hint: item.text,
      text: item.text,
      player: item.player,
      time: item.time,
    });
    hintTexts.add(item.text);
  });

  const submittedPlayers = new Set(
    result
      .filter((item) => inferredLogType(item) === "submit")
      .map((item) => text(item.player ?? item.submitted_by)),
  );
  Object.entries(submissions).forEach(([player, submission]) => {
    if (submittedPlayers.has(player)) return;
    append({
      type: "submit",
      player,
      text: `已提交完整推理 · ${submission.total} 分 ${submission.rank}`,
      time: submission.submitted_at,
      request_id: submission.request_id || `submission-${player}`,
    });
  });
  return result;
}

function readQuestionLeft(
  data: UnknownRecord,
  previous: GameState | undefined,
  player: string,
): number | null {
  const generic = record(data.questions_left)[player];
  const legacy = data[`${player}_questions_left`];
  const incoming = generic ?? legacy;
  if (incoming === null) return null;
  if (incoming != null && Number.isFinite(Number(incoming))) {
    const incomingNumber = Number(incoming);
    const previousValue = previous?.questions_left[player];
    return typeof previousValue === "number"
      ? Math.min(previousValue, incomingNumber)
      : incomingNumber;
  }
  return previous?.questions_left[player] ?? null;
}

export function normalizeState(
  raw: unknown,
  previous: GameState | undefined,
  mode: GameMode,
  players: PlayerConfig,
): GameState {
  const data = record(raw);
  const hints = collectHints(data, previous);
  const incomingUsed = finite(data.hints_used, 0);
  const hasHintLedger =
    Array.isArray(data.revealed_hints) ||
    Array.isArray(data.hints_log) ||
    Array.isArray(data.hint_history) ||
    Array.isArray(data.used_hints) ||
    data.hint != null ||
    data.hint_content != null ||
    data.hint_text != null ||
    data.latest_hint != null ||
    data.current_hint != null;
  const hintsUsed =
    hasHintLedger || hints.length > 0
      ? hints.length
      : Math.max(incomingUsed, previous?.hints_used ?? 0);
  const submissions = collectSubmissions(data, previous);
  const revealed = Boolean(
    data.soup_bottom_revealed ||
      data.revealed ||
      previous?.soup_bottom_revealed,
  );
  const resolvedMode = (data.mode ?? previous?.mode ?? mode) as GameMode;
  const incomingStatus = text(data.status ?? previous?.status ?? "playing");
  const resolvedStatus =
    previous && isRoundClosed(previous) && incomingStatus === "playing"
      ? previous.status
      : incomingStatus;
  const hintsTotal =
    data.hints_total === null
      ? null
      : data.hints_total != null
        ? finite(data.hints_total, previous?.hints_total ?? 0)
        : previous?.hints_total !== undefined
          ? previous.hints_total
          : resolvedMode === "easy"
            ? null
            : 0;
  const questionsLeft = {
    ...(previous?.questions_left ?? {}),
    ...record(data.questions_left),
    [players.humanId]: readQuestionLeft(data, previous, players.humanId),
    [players.aiId]: readQuestionLeft(data, previous, players.aiId),
  } as Record<string, number | null>;

  const state: GameState = {
    ...(previous ?? ({} as GameState)),
    ...data,
    session_id: (data.session_id ?? previous?.session_id ?? "") as
      | string
      | number,
    status: resolvedStatus,
    title: text(data.title ?? previous?.title ?? "未命名汤"),
    soup_face: text(data.soup_face ?? previous?.soup_face),
    soup_bottom:
      text(data.soup_bottom ?? previous?.soup_bottom) || undefined,
    soup_bottom_revealed: revealed,
    difficulty: text(data.difficulty ?? previous?.difficulty ?? "中等"),
    mode: resolvedMode,
    current_player: text(data.current_player ?? previous?.current_player) ||
      undefined,
    questions_left: questionsLeft,
    hints_used: hintsUsed,
    hints_total: hintsTotal,
    revealed_hints: hints,
    questions_log: [],
    submissions,
    room_key: text(data.room_key ?? previous?.room_key) || undefined,
  };
  state.questions_log = mergeLogs(data, previous, hints, submissions);
  return state;
}

export function appendLogIfMissing(state: GameState, item: GameLog): GameState {
  const key = logSignature(item);
  if (state.questions_log.some((entry) => logSignature(entry) === key)) {
    return state;
  }
  return { ...state, questions_log: [...state.questions_log, item] };
}

export const bestSubmission = (state?: GameState | null) =>
  Object.values(state?.submissions ?? {}).sort(
    (a, b) => b.total - a.total,
  )[0] ?? null;
