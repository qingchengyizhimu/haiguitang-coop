"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  appendLogIfMissing,
  bestSubmission,
  createRequestId,
  demoAnswer,
  demoHints,
  demoState,
  hintText,
  isRoundClosed,
  modeNames,
  normalizeState,
  normalizeSubmission,
  rankFromScore,
  type GameMode,
  type GameState,
  type Submission,
} from "../lib/game";

type View = "welcome" | "lobby" | "game";
type DialogKind =
  | "rules"
  | "settings"
  | "ask"
  | "hint-confirm"
  | "hint-result"
  | "submit"
  | "result"
  | "abandon"
  | null;

interface DialogState {
  kind: DialogKind;
  error?: string;
  hint?: string;
  hintIndex?: number;
  remote?: boolean;
  player?: string;
}

interface RuntimeConfig {
  apiBase: string;
  roomKey: string;
  pollMs: number;
  fallbackDemo: boolean;
  autoJoin: boolean;
  humanId: string;
  aiId: string;
  humanName: string;
  aiName: string;
}

interface ApiError extends Error {
  status?: number;
  data?: Record<string, unknown>;
  noDemo?: boolean;
}

const STORAGE = {
  config: "haiguitang_open_config_v1",
  state: "haiguitang_open_state_v1",
  session: "haiguitang_open_session_v1",
  mode: "haiguitang_open_mode_v1",
  settlement: "haiguitang_open_settlement_v1",
  left: "haiguitang_open_left_sessions_v1",
  rules: "haiguitang_open_rules_seen_v1",
};

const DEFAULT_CONFIG: RuntimeConfig = {
  apiBase: process.env.NEXT_PUBLIC_TURTLE_API_BASE || "/api/game",
  roomKey: process.env.NEXT_PUBLIC_TURTLE_ROOM_KEY || "haiguitang-main",
  pollMs: 3000,
  fallbackDemo: true,
  autoJoin: true,
  humanId: "xinxin",
  aiId: process.env.NEXT_PUBLIC_TURTLE_AI_PLAYER_ID || "azhi",
  humanName: "玩家",
  aiName: "AI 搭档",
};

const WEB_SOURCE =
  process.env.NEXT_PUBLIC_TURTLE_SOURCE || "standalone-web";

const now = () =>
  new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const clampScore = (value: number) => Math.max(0, Math.min(100, value));

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function answerClass(answer?: string) {
  if (answer === "是") return "answer--yes";
  if (answer === "否") return "answer--no";
  if (answer === "部分相关" || answer === "是也不是") return "answer--mixed";
  if (answer === "驳回") return "answer--reject";
  return "answer--neutral";
}

export default function Home() {
  const [config, setConfig] = useState<RuntimeConfig>(() =>
    loadJson(STORAGE.config, DEFAULT_CONFIG),
  );
  const [view, setView] = useState<View>("welcome");
  const [selectedMode, setSelectedMode] = useState<GameMode>(() => {
    if (typeof window === "undefined") return "normal";
    const saved = window.localStorage.getItem(STORAGE.mode);
    return saved === "easy" || saved === "hard" ? saved : "normal";
  });
  const [game, setGame] = useState<GameState | null>(null);
  const [realSession, setRealSession] = useState(false);
  const [pendingNext, setPendingNext] = useState<GameState | null>(null);
  const [settlementLocked, setSettlementLocked] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ kind: null });
  const [toastMessage, setToastMessage] = useState("");
  const [roomMessage, setRoomMessage] = useState(
    "会自动寻找同一房间里由网页或 AI 开始的游戏。",
  );
  const [joinId, setJoinId] = useState("");
  const [questionDraft, setQuestionDraft] = useState("");
  const [theoryDraft, setTheoryDraft] = useState("");
  const [busy, setBusy] = useState({
    start: false,
    join: false,
    ask: false,
    hint: false,
    submit: false,
    reveal: false,
    abandon: false,
  });

  const gameRef = useRef<GameState | null>(null);
  const configRef = useRef(config);
  const dialogRef = useRef(dialog);
  const realSessionRef = useRef(false);
  const pendingNextRef = useRef<GameState | null>(null);
  const pollBusyRef = useRef(false);
  const bootedRef = useRef(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRequestsRef = useRef<Record<string, string>>({});
  const settlementPresentedRef = useRef<string | null>(null);
  const queuedSettlementRef = useRef<string | null>(null);
  const activeSyncPausedRef = useRef(false);
  const activeSyncResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const playerName = (player?: string) => {
    if (player === config.aiId) return config.aiName;
    if (player === config.humanId) return config.humanName;
    return player || "主持人";
  };

  const commitGame = (next: GameState | null, isReal = realSessionRef.current) => {
    gameRef.current = next;
    realSessionRef.current = isReal;
    setGame(next);
    setRealSession(isReal);
    if (typeof window === "undefined") return;
    if (!next?.session_id) {
      window.localStorage.removeItem(STORAGE.session);
      window.localStorage.removeItem(STORAGE.state);
      return;
    }
    window.localStorage.setItem(STORAGE.session, String(next.session_id));
    window.localStorage.setItem(STORAGE.state, JSON.stringify(next));
  };

  const setPending = (next: GameState | null) => {
    pendingNextRef.current = next;
    setPendingNext(next);
  };

  const holdSettlement = (sessionId: string | number) => {
    window.localStorage.setItem(STORAGE.settlement, String(sessionId));
    setSettlementLocked(true);
  };

  const releaseSettlement = () => {
    window.localStorage.removeItem(STORAGE.settlement);
    setSettlementLocked(false);
  };

  const settlementHeld = (state: GameState | null) =>
    Boolean(
      state?.session_id &&
        window.localStorage.getItem(STORAGE.settlement) ===
          String(state.session_id),
    );

  const leftSessions = () => loadJson<string[]>(STORAGE.left, []).map(String);

  const markLeft = (sessionId?: string | number) => {
    if (sessionId == null) return;
    const next = leftSessions().filter((id) => id !== String(sessionId));
    next.push(String(sessionId));
    window.localStorage.setItem(STORAGE.left, JSON.stringify(next.slice(-20)));
  };

  const unmarkLeft = (sessionId?: string | number) => {
    if (sessionId == null) return;
    window.localStorage.setItem(
      STORAGE.left,
      JSON.stringify(leftSessions().filter((id) => id !== String(sessionId))),
    );
  };

  const toast = (message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(""), 2800);
  };

  const changeView = (next: View) => {
    setView((current) => {
      if (current !== next) {
        requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
      }
      return next;
    });
  };

  const openDialog = (next: DialogState) => {
    dialogRef.current = next;
    setDialog(next);
  };

  const closeDialog = () => {
    dialogRef.current = { kind: null };
    setDialog({ kind: null });
    const queued = queuedSettlementRef.current;
    queuedSettlementRef.current = null;
    if (
      queued &&
      gameRef.current &&
      String(gameRef.current.session_id) === queued &&
      isRoundClosed(gameRef.current)
    ) {
      setTimeout(() => showResult(undefined, true), 0);
    }
  };

  const request = async (
    path: string,
    method: "GET" | "POST" = "GET",
    body?: Record<string, unknown>,
  ) => {
    const base = configRef.current.apiBase.replace(/\/$/, "");
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch (cause) {
      const error = new Error("无法连接主持人，请检查 API 地址与 HTTPS/CORS 配置。") as ApiError;
      error.cause = cause;
      throw error;
    }
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      const error = new Error(
        String(data.error || data.reason || `主持人暂时没有回应（${response.status}）`),
      ) as ApiError;
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  };

  const requestIdFor = (key: string) => {
    if (!pendingRequestsRef.current[key]) {
      pendingRequestsRef.current[key] = createRequestId();
    }
    return pendingRequestsRef.current[key];
  };

  const clearRequestId = (key: string) => {
    delete pendingRequestsRef.current[key];
  };

  const showResult = (player?: string, force = false) => {
    const current = gameRef.current;
    if (!current) return;
    const sessionId = String(current.session_id);
    if (isRoundClosed(current)) holdSettlement(current.session_id);
    if (
      !force &&
      dialogRef.current.kind &&
      dialogRef.current.kind !== "result"
    ) {
      queuedSettlementRef.current = sessionId;
      toast("本局已进入结算，关闭当前弹窗后会显示结果");
      return;
    }
    settlementPresentedRef.current = sessionId;
    openDialog({ kind: "result", player });
  };

  const presentSettlementIfNeeded = (
    previous: GameState | null,
    next: GameState,
  ) => {
    if (!isRoundClosed(next)) return;
    holdSettlement(next.session_id);
    const sessionId = String(next.session_id);
    const alreadyClosed =
      previous &&
      String(previous.session_id) === sessionId &&
      isRoundClosed(previous);
    if (alreadyClosed || settlementPresentedRef.current === sessionId) return;
    showResult(undefined, false);
  };

  const discoverActive = async (silent = true, allowSwitch = false) => {
    try {
      const data = await request(
        `/active?room_key=${encodeURIComponent(configRef.current.roomKey)}`,
      );
      if (!data.session_id) return false;
      const current = gameRef.current;
      const same =
        current?.session_id != null &&
        String(current.session_id) === String(data.session_id);
      const normalized = normalizeState(
        data,
        same ? current ?? undefined : undefined,
        selectedMode,
        {
          humanId: configRef.current.humanId,
          aiId: configRef.current.aiId,
        },
      );

      if (
        current &&
        !same &&
        (isRoundClosed(current) || settlementHeld(current)) &&
        !allowSwitch
      ) {
        setPending(normalized);
        setRoomMessage(
          `下一题 Session ${normalized.session_id} 已准备好，当前结算会保留到你手动进入。`,
        );
        return true;
      }

      if (!same) {
        setPending(null);
        settlementPresentedRef.current = null;
        queuedSettlementRef.current = null;
        releaseSettlement();
      }
      commitGame(normalized, true);
      changeView("game");
      setRoomMessage(`已同步共享房间 · Session ${normalized.session_id}`);
      if (!silent) toast(same ? "共享进度已同步" : "已进入双方当前游戏");
      presentSettlementIfNeeded(current, normalized);
      return true;
    } catch {
      if (!silent) {
        setRoomMessage("当前没有活跃游戏，也可以粘贴 session_id 加入。");
      }
      return false;
    }
  };

  const activateSession = async (sessionId: string | number) => {
    try {
      await request("/activate", "POST", {
        session_id: sessionId,
        room_key: configRef.current.roomKey,
        player: configRef.current.humanId,
        source: WEB_SOURCE,
        request_id: createRequestId(),
      });
      return true;
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.status === 404 || apiError.status === 405) {
        activeSyncPausedRef.current = true;
        if (activeSyncResumeTimerRef.current) {
          clearTimeout(activeSyncResumeTimerRef.current);
        }
        activeSyncResumeTimerRef.current = setTimeout(() => {
          activeSyncPausedRef.current = false;
        }, 30_000);
        return false;
      }
      throw error;
    }
  };

  const joinSession = async (
    rawId: string | number,
    options: { silent?: boolean; activate?: boolean } = {},
  ) => {
    const sessionId = String(rawId).trim();
    if (!sessionId || busy.join) {
      if (!sessionId) toast("请先输入 Session ID");
      return false;
    }
    setBusy((value) => ({ ...value, join: true }));
    try {
      const data = await request(
        `/status?session_id=${encodeURIComponent(sessionId)}`,
      );
      const normalized = normalizeState(
        data,
        gameRef.current?.session_id != null &&
          String(gameRef.current.session_id) === sessionId
          ? gameRef.current
          : undefined,
        selectedMode,
        {
          humanId: configRef.current.humanId,
          aiId: configRef.current.aiId,
        },
      );
      let activated = true;
      if (options.activate !== false) activated = await activateSession(normalized.session_id);
      unmarkLeft(normalized.session_id);
      setPending(null);
      settlementPresentedRef.current = null;
      queuedSettlementRef.current = null;
      if (isRoundClosed(normalized)) holdSettlement(normalized.session_id);
      else releaseSettlement();
      commitGame(normalized, true);
      changeView("game");
      setJoinId("");
      setRoomMessage(
        activated
          ? `已加入并同步 Session ${normalized.session_id}`
          : `已加入 Session ${normalized.session_id}；后端尚未提供 /activate`,
      );
      if (!options.silent) toast("游戏已同步");
      presentSettlementIfNeeded(null, normalized);
      return true;
    } catch (error) {
      if (!options.silent) toast((error as Error).message || "没有找到这个游戏");
      return false;
    } finally {
      setBusy((value) => ({ ...value, join: false }));
    }
  };

  const startGame = async (forceNew = false, mode = selectedMode) => {
    if (busy.start) return;
    setBusy((value) => ({ ...value, start: true }));
    const key = `start:${mode}:${forceNew}:${configRef.current.roomKey}`;
    try {
      const data = await request("/start", "POST", {
        mode,
        room_key: configRef.current.roomKey,
        reuse_active: !forceNew,
        force_new: forceNew,
        player: configRef.current.humanId,
        source: WEB_SOURCE,
        request_id: requestIdFor(key),
      });
      const normalized = normalizeState(data, undefined, mode, {
        humanId: configRef.current.humanId,
        aiId: configRef.current.aiId,
      });
      if (forceNew && leftSessions().includes(String(normalized.session_id))) {
        const conflict = new Error(
          `后端仍返回已离开的旧 Session ${normalized.session_id}，请确认 force_new=true 会创建新局。`,
        ) as ApiError;
        conflict.noDemo = true;
        throw conflict;
      }
      clearRequestId(key);
      unmarkLeft(normalized.session_id);
      setPending(null);
      releaseSettlement();
      settlementPresentedRef.current = null;
      queuedSettlementRef.current = null;
      commitGame(normalized, true);
      changeView("game");
      setRoomMessage(`共享房间 · Session ${normalized.session_id}`);
      closeDialog();
      toast("主持人已经放出汤面");
    } catch (error) {
      const apiError = error as ApiError;
      const canUseDemo =
        configRef.current.fallbackDemo &&
        !apiError.noDemo &&
        (!apiError.status ||
          apiError.status === 404 ||
          apiError.status === 405 ||
          apiError.status >= 500);
      if (!canUseDemo) {
        toast(apiError.message || "无法开始游戏");
        return;
      }
      const fallback = demoState(mode, {
        humanId: configRef.current.humanId,
        aiId: configRef.current.aiId,
      });
      clearRequestId(key);
      setPending(null);
      releaseSettlement();
      settlementPresentedRef.current = null;
      commitGame(fallback, false);
      changeView("game");
      setRoomMessage("本地演示模式 · 不会写入后端");
      closeDialog();
      toast("后端未连接，已进入交互演示");
    } finally {
      setBusy((value) => ({ ...value, start: false }));
    }
  };

  const syncCurrent = async () => {
    if (pollBusyRef.current || !realSessionRef.current) return;
    const current = gameRef.current;
    if (!current?.session_id) return;
    pollBusyRef.current = true;
    try {
      const sessionId = current.session_id;
      const data = await request(
        `/status?session_id=${encodeURIComponent(sessionId)}`,
      );
      if (
        !gameRef.current ||
        String(gameRef.current.session_id) !== String(sessionId)
      ) {
        return;
      }
      const previous = gameRef.current;
      const normalized = normalizeState(data, previous, selectedMode, {
        humanId: configRef.current.humanId,
        aiId: configRef.current.aiId,
      });
      commitGame(normalized, true);

      const oldHints = new Set(previous.revealed_hints.map((item) => item.text));
      const freshHints = normalized.revealed_hints.filter(
        (item) => !oldHints.has(item.text),
      );
      if (freshHints.length) {
        const latest = freshHints[freshHints.length - 1];
        if (!dialogRef.current.kind) {
          openDialog({
            kind: "hint-result",
            hint: latest.text,
            hintIndex: latest.index,
            remote: true,
          });
        } else {
          toast("新提示已同步到共同推理记录");
        }
      }
      presentSettlementIfNeeded(previous, normalized);
      if (
        configRef.current.autoJoin &&
        !activeSyncPausedRef.current
      ) {
        await discoverActive(true, false);
      }
    } catch {
      // 短暂网络波动不清空本地局面；下一轮继续同步。
    } finally {
      pollBusyRef.current = false;
    }
  };

  const submitQuestion = async () => {
    const current = gameRef.current;
    const question = questionDraft.trim();
    if (!current || !question || busy.ask) return;
    const key = `ask:${current.session_id}:${question}`;
    const requestId = requestIdFor(key);
    setBusy((value) => ({ ...value, ask: true }));
    try {
      let answer = "";
      let reason = "";
      let next = current;
      if (realSessionRef.current) {
        const data = await request("/ask", "POST", {
          session_id: current.session_id,
          player: configRef.current.humanId,
          source: WEB_SOURCE,
          request_id: requestId,
          question,
        });
        if (
          !gameRef.current ||
          String(gameRef.current.session_id) !== String(current.session_id)
        ) {
          toast("房间已切换，旧房间的回答不会写入新局");
          return;
        }
        answer = String(data.answer || "是也不是");
        reason = String(data.reason || "");
        next = normalizeState(data, current, selectedMode, {
          humanId: configRef.current.humanId,
          aiId: configRef.current.aiId,
        });
      } else {
        const result = demoAnswer(question);
        answer = result.answer;
        reason = result.reason || "";
        if (answer !== "驳回") {
          next = {
            ...current,
            questions_left: {
              ...current.questions_left,
              [configRef.current.humanId]:
                current.questions_left[configRef.current.humanId] == null
                  ? null
                  : Math.max(
                      0,
                      Number(
                        current.questions_left[configRef.current.humanId],
                      ) - 1,
                    ),
            },
          };
        }
      }
      const semanticExists = next.questions_log.some(
        (item) =>
          item.player === configRef.current.humanId &&
          (item.question || item.text) === question &&
          item.answer === answer,
      );
      if (!semanticExists) {
        next = appendLogIfMissing(next, {
          type: "question",
          player: configRef.current.humanId,
          source: WEB_SOURCE,
          request_id: requestId,
          question,
          text: question,
          answer,
          time: now(),
        });
      }
      commitGame(next);
      clearRequestId(key);
      if (answer === "驳回") {
        openDialog({
          kind: "ask",
          error: reason || "请改成能用是或否回答的问题。",
        });
      } else {
        setQuestionDraft("");
        closeDialog();
        toast(`主持人回答：${answer}`);
      }
    } catch (error) {
      openDialog({ kind: "ask", error: (error as Error).message });
    } finally {
      setBusy((value) => ({ ...value, ask: false }));
    }
  };

  const takeHint = async () => {
    const current = gameRef.current;
    if (!current || busy.hint) return;
    const expectedIndex = current.hints_used + 1;
    const key = `hint:${current.session_id}:${expectedIndex}`;
    const requestId = requestIdFor(key);
    setBusy((value) => ({ ...value, hint: true }));
    try {
      let content = "";
      let next = current;
      if (realSessionRef.current) {
        const data = await request("/hint", "POST", {
          session_id: current.session_id,
          player: configRef.current.humanId,
          source: WEB_SOURCE,
          request_id: requestId,
        });
        if (
          !gameRef.current ||
          String(gameRef.current.session_id) !== String(current.session_id)
        ) {
          toast("房间已切换，旧房间的提示不会写入新局");
          return;
        }
        content =
          hintText(data.hint) ||
          hintText(data.hint_content) ||
          hintText(data.hint_text) ||
          hintText(data.content) ||
          hintText(data.latest_hint);
        next = normalizeState(data, current, selectedMode, {
          humanId: configRef.current.humanId,
          aiId: configRef.current.aiId,
        });
      } else {
        content = demoHints[Math.min(current.hints_used, demoHints.length - 1)];
        next = normalizeState(
          {
            hints_used: current.hints_used + 1,
            revealed_hints: [
              ...current.revealed_hints,
              {
                index: expectedIndex,
                hint: content,
                player: configRef.current.humanId,
                time: now(),
              },
            ],
          },
          current,
          selectedMode,
          {
            humanId: configRef.current.humanId,
            aiId: configRef.current.aiId,
          },
        );
      }
      if (!content) {
        const newest = next.revealed_hints.find(
          (item) => item.index === expectedIndex,
        );
        content = newest?.text || "";
      }
      commitGame(next);
      clearRequestId(key);
      if (content) {
        openDialog({
          kind: "hint-result",
          hint: content,
          hintIndex: expectedIndex,
        });
      } else {
        closeDialog();
        toast("提示已计数，但后端没有返回提示内容");
      }
    } catch (error) {
      openDialog({ kind: "hint-confirm", error: (error as Error).message });
    } finally {
      setBusy((value) => ({ ...value, hint: false }));
    }
  };

  const submitTheory = async () => {
    const current = gameRef.current;
    const answerText = theoryDraft.trim();
    if (!current || busy.submit) return;
    if (answerText.length < 8) {
      openDialog({ kind: "submit", error: "请先写出较完整的推理。" });
      return;
    }
    if (current.submissions[configRef.current.humanId]) {
      showResult(configRef.current.humanId, true);
      return;
    }
    const key = `submit:${current.session_id}:${answerText}`;
    const requestId = requestIdFor(key);
    setBusy((value) => ({ ...value, submit: true }));
    try {
      let next = current;
      let submission: Submission;
      if (realSessionRef.current) {
        const data = await request("/submit", "POST", {
          session_id: current.session_id,
          player: configRef.current.humanId,
          source: WEB_SOURCE,
          request_id: requestId,
          answer: answerText,
        });
        if (
          !gameRef.current ||
          String(gameRef.current.session_id) !== String(current.session_id)
        ) {
          toast("房间已切换，旧房间的评分不会写入新局");
          return;
        }
        next = normalizeState(data, current, selectedMode, {
          humanId: configRef.current.humanId,
          aiId: configRef.current.aiId,
        });
        submission =
          next.submissions[configRef.current.humanId] ||
          normalizeSubmission(
            {
              score: data.score ?? data.overall,
              rank: data.rank,
              score_detail: data.score_detail ?? data.detail,
              comment: data.comment,
              submitted_answer: answerText,
              request_id: requestId,
            },
            configRef.current.humanId,
          )!;
      } else {
        const hits = ["信号", "送货", "预留", "取走", "约定"].filter((word) =>
          answerText.includes(word),
        ).length;
        const keyPlot = Math.min(100, 35 + hits * 13);
        const logic = Math.min(
          96,
          answerText.length > 42 ? 86 : answerText.length > 24 ? 74 : 58,
        );
        const detail = Math.min(
          96,
          38 +
            ["面包", "灯", "店主", "取走"].filter((word) =>
              answerText.includes(word),
            ).length *
              14,
        );
        const total = Math.round(keyPlot * 0.4 + logic * 0.3 + detail * 0.3);
        submission = {
          submitted: true,
          player: configRef.current.humanId,
          total,
          rank: rankFromScore(total),
          key_plot: keyPlot,
          logic,
          detail,
          comment: "演示评分仅用于体验界面，正式游戏由后端主持人评分。",
          answer: answerText,
          request_id: requestId,
          submitted_at: now(),
        };
      }

      next = {
        ...next,
        submissions: {
          ...next.submissions,
          [configRef.current.humanId]: {
            ...submission,
            answer: submission.answer || answerText,
          },
        },
      };
      if (next.mode !== "easy") {
        next = {
          ...next,
          questions_left: {
            ...next.questions_left,
            [configRef.current.humanId]: 0,
          },
        };
      }
      if (submission.total >= 90) next = { ...next, status: "won" };
      else if (
        next.mode !== "easy" &&
        Number(next.questions_left[configRef.current.aiId] || 0) <= 0
      ) {
        next = { ...next, status: "lost" };
      }
      next = appendLogIfMissing(next, {
        type: "submit",
        player: configRef.current.humanId,
        source: WEB_SOURCE,
        request_id: requestId,
        text: `已提交完整推理 · ${submission.total} 分 ${submission.rank}`,
        submitted_answer: answerText,
        time: now(),
      });
      commitGame(next);
      clearRequestId(key);
      setTheoryDraft("");
      showResult(configRef.current.humanId, true);
    } catch (error) {
      const apiError = error as ApiError;
      if (
        apiError.status === 409 ||
        apiError.data?.error === "already_submitted"
      ) {
        await syncCurrent();
        if (gameRef.current?.submissions[configRef.current.humanId]) {
          clearRequestId(key);
          showResult(configRef.current.humanId, true);
          return;
        }
      }
      openDialog({ kind: "submit", error: apiError.message });
    } finally {
      setBusy((value) => ({ ...value, submit: false }));
    }
  };

  const revealBottom = async () => {
    const current = gameRef.current;
    if (!current || busy.reveal) return;
    const key = `reveal:${current.session_id}`;
    setBusy((value) => ({ ...value, reveal: true }));
    holdSettlement(current.session_id);
    try {
      let next = current;
      if (realSessionRef.current) {
        const data = await request("/reveal", "POST", {
          session_id: current.session_id,
          room_key: configRef.current.roomKey,
          player: configRef.current.humanId,
          source: WEB_SOURCE,
          request_id: requestIdFor(key),
        });
        if (
          !gameRef.current ||
          String(gameRef.current.session_id) !== String(current.session_id)
        ) {
          toast("房间已切换，旧房间的汤底不会写入新局");
          return;
        }
        next = normalizeState(data, current, selectedMode, {
          humanId: configRef.current.humanId,
          aiId: configRef.current.aiId,
        });
      }
      next = {
        ...next,
        soup_bottom_revealed: true,
        status: next.status === "won" ? "won" : "lost",
      };
      clearRequestId(key);
      commitGame(next);
      showResult(dialogRef.current.player, true);
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy((value) => ({ ...value, reveal: false }));
    }
  };

  const abandonRound = async () => {
    const current = gameRef.current;
    if (!current || busy.abandon) return;
    setBusy((value) => ({ ...value, abandon: true }));
    try {
      if (realSessionRef.current) {
        await request("/abandon", "POST", {
          session_id: current.session_id,
          room_key: configRef.current.roomKey,
          player: configRef.current.humanId,
          source: WEB_SOURCE,
          request_id: createRequestId(),
        });
      }
      markLeft(current.session_id);
      setPending(null);
      releaseSettlement();
      settlementPresentedRef.current = null;
      commitGame(null, false);
      closeDialog();
      changeView("lobby");
      setRoomMessage("已离开上一局；下一次抽题会创建新 Session。");
      toast("已放弃本局，没有评分或揭底");
    } catch (error) {
      openDialog({ kind: "abandon", error: (error as Error).message });
    } finally {
      setBusy((value) => ({ ...value, abandon: false }));
    }
  };

  const proceedToNext = async () => {
    const current = gameRef.current;
    const ready = pendingNextRef.current;
    if (ready) {
      const previousId = current?.session_id;
      const joined = await joinSession(ready.session_id, {
        silent: true,
        activate: false,
      });
      if (joined) {
        if (previousId != null) markLeft(previousId);
        releaseSettlement();
        closeDialog();
        toast(`已进入下一题 · Session ${ready.session_id}`);
      }
      return;
    }
    if (current?.session_id != null) markLeft(current.session_id);
    releaseSettlement();
    await startGame(true, current?.mode || selectedMode);
  };

  const returnToLobby = () => {
    const current = gameRef.current;
    if (current && isRoundClosed(current)) markLeft(current.session_id);
    setPending(null);
    releaseSettlement();
    settlementPresentedRef.current = null;
    commitGame(null, false);
    closeDialog();
    changeView("lobby");
    setRoomMessage("选择模式后再抽一题，或加入已有 Session。");
  };

  const saveSettings = () => {
    const next: RuntimeConfig = {
      ...config,
      apiBase: config.apiBase.trim() || "/api/game",
      roomKey: config.roomKey.trim() || DEFAULT_CONFIG.roomKey,
      pollMs: Math.max(1200, Number(config.pollMs) || 3000),
      humanId: config.humanId.trim() || "xinxin",
      aiId: config.aiId.trim() || DEFAULT_CONFIG.aiId,
      humanName: config.humanName.trim() || "玩家",
      aiName: config.aiName.trim() || "AI 搭档",
    };
    configRef.current = next;
    setConfig(next);
    window.localStorage.setItem(STORAGE.config, JSON.stringify(next));
    closeDialog();
    toast("连接设置已保存在当前浏览器");
  };

  useEffect(() => {
    configRef.current = config;
    window.localStorage.setItem(STORAGE.config, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  useEffect(() => {
    pendingNextRef.current = pendingNext;
  }, [pendingNext]);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    let cancelled = false;
    const boot = async () => {
      const cachedRaw = loadJson<Record<string, unknown> | null>(STORAGE.state, null);
      let cached: GameState | null = null;
      if (cachedRaw?.session_id != null) {
        cached = normalizeState(cachedRaw, undefined, selectedMode, {
          humanId: configRef.current.humanId,
          aiId: configRef.current.aiId,
        });
      }
      if (cached && leftSessions().includes(String(cached.session_id))) cached = null;

      if (cached && isRoundClosed(cached)) {
        commitGame(cached, !String(cached.session_id).startsWith("demo-"));
        changeView("game");
        holdSettlement(cached.session_id);
        showResult(undefined, true);
        if (!String(cached.session_id).startsWith("demo-")) {
          try {
            const data = await request(
              `/status?session_id=${encodeURIComponent(cached.session_id)}`,
            );
            if (!cancelled) {
              const latest = normalizeState(data, cached, selectedMode, {
                humanId: configRef.current.humanId,
                aiId: configRef.current.aiId,
              });
              commitGame(latest, true);
              showResult(undefined, true);
            }
          } catch {
            // 离线时继续展示完整本地结算缓存。
          }
        }
        if (configRef.current.autoJoin) await discoverActive(true, false);
        return;
      }

      if (configRef.current.autoJoin && (await discoverActive(true, false))) return;
      if (cached) {
        commitGame(cached, !String(cached.session_id).startsWith("demo-"));
        changeView("game");
        if (!String(cached.session_id).startsWith("demo-")) {
          await joinSession(cached.session_id, { silent: true, activate: false });
        }
        return;
      }
      changeView("welcome");
    };
    void boot();
    return () => {
      cancelled = true;
    };
    // 启动流程只运行一次，后续配置由设置页显式修改。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!realSession || view !== "game" || !game?.session_id) return;
    const timer = window.setInterval(
      () => void syncCurrent(),
      Math.max(1200, config.pollMs),
    );
    return () => window.clearInterval(timer);
    // 轮询通过 ref 读取最新局面，避免每次渲染重建定时器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realSession, view, game?.session_id, config.pollMs]);

  useEffect(() => {
    if (view !== "lobby" || !config.autoJoin) return;
    const timer = window.setInterval(
      () => void discoverActive(true, false),
      Math.max(1200, config.pollMs),
    );
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, config.autoJoin, config.pollMs]);

  useEffect(() => {
    const element = logRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distance < 150) element.scrollTop = element.scrollHeight;
  }, [game?.questions_log.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dialogRef.current.kind) closeDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const humanLeft = game?.questions_left[config.humanId] ?? null;
  const aiLeft = game?.questions_left[config.aiId] ?? null;
  const hintsLeft =
    game?.hints_total == null
      ? null
      : Math.max(0, game.hints_total - game.hints_used);
  const humanSubmission = game?.submissions[config.humanId];
  const partnerSubmission = game?.submissions[config.aiId];
  const closed = isRoundClosed(game);
  const canAsk = Boolean(
    game &&
      !closed &&
      !humanSubmission &&
      !busy.ask &&
      (humanLeft == null || humanLeft > 0),
  );
  const canHint = Boolean(
    game &&
      !closed &&
      game.mode !== "hard" &&
      game.hints_total !== 0 &&
      (hintsLeft == null || hintsLeft > 0),
  );

  const resultSubmission = useMemo(() => {
    if (!game) return null;
    return (
      (dialog.player ? game.submissions[dialog.player] : null) ||
      bestSubmission(game)
    );
  }, [game, dialog.player]);

  return (
    <main className="app-shell">
      <div className="sky-glow sky-glow--one" />
      <div className="sky-glow sky-glow--two" />
      <div className="stars" aria-hidden="true" />

      <header className="site-header">
        <button
          className="brand"
          onClick={() => (game ? changeView("game") : changeView("welcome"))}
          aria-label="回到海龟汤首页"
        >
          <span className="brand-mark" aria-hidden="true">
            龟
          </span>
          <span>
            <b>海龟汤</b>
            <small>人机共游版</small>
          </span>
        </button>
        <nav className="header-actions" aria-label="快捷操作">
          {view === "game" && game && (
            <button className="quiet-button" onClick={() => openDialog({ kind: "rules" })}>
              规则
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => openDialog({ kind: "settings" })}
            aria-label="连接设置"
            title="连接设置"
          >
            ⚙
          </button>
        </nav>
      </header>

      {view === "welcome" && (
        <section className="welcome-screen page-enter">
          <div className="welcome-copy">
            <p className="eyebrow">CO-OP LATERAL THINKING</p>
            <h1>
              一碗谜题，
              <br />
              两个人的推理现场。
            </h1>
            <p className="welcome-lead">
              人类在网页操作，AI 通过 MCP 参与。双方共享同一个房间、同一份日志和同一场结算。
            </p>
            <div className="welcome-actions">
              <button
                className="primary-button"
                onClick={() => {
                  window.localStorage.setItem(STORAGE.rules, "1");
                  changeView("lobby");
                }}
              >
                进入游戏机 <span>→</span>
              </button>
              <button className="text-button" onClick={() => openDialog({ kind: "rules" })}>
                先读玩法
              </button>
            </div>
            <div className="feature-line" aria-label="产品特性">
              <span>共享房间</span>
              <i />
              <span>断点恢复</span>
              <i />
              <span>三维评分</span>
            </div>
          </div>

          <div className="welcome-visual" aria-label="海龟汤游戏预览">
            <div className="orbit orbit--outer" />
            <div className="orbit orbit--inner" />
            <div className="soup-bowl">
              <div className="soup-surface">
                <span className="steam steam--one">∿</span>
                <span className="steam steam--two">∿</span>
                <b>?</b>
              </div>
            </div>
            <div className="floating-card floating-card--left">
              <small>主持人</small>
              <b>是也不是</b>
            </div>
            <div className="floating-card floating-card--right">
              <small>共同记录</small>
              <b>12 条线索</b>
            </div>
          </div>
        </section>
      )}

      {view === "lobby" && (
        <section className="lobby-screen page-enter">
          <div className="section-heading">
            <p className="eyebrow">CHOOSE YOUR PACE</p>
            <h1>今晚，想怎么推理？</h1>
            <p>先选择通关节奏。网页和 AI 任一方开局，另一方都会从共享房间同步。</p>
          </div>

          <div className="mode-grid">
            {(
              [
                {
                  mode: "easy" as const,
                  number: "∞",
                  name: "轻松",
                  copy: "不限提问与提示，适合慢慢拆解。",
                  meta: "无限提问 · 无限提示",
                },
                {
                  mode: "normal" as const,
                  number: "06",
                  name: "正常",
                  copy: "每人六问，三层提示，节奏刚好。",
                  meta: "每人 6 问 · 3 次提示",
                },
                {
                  mode: "hard" as const,
                  number: "03",
                  name: "困难",
                  copy: "三轮定方向，没有提示可依赖。",
                  meta: "每人 3 问 · 无提示",
                },
              ] as const
            ).map((item) => (
              <button
                key={item.mode}
                className={`mode-card ${selectedMode === item.mode ? "mode-card--selected" : ""}`}
                onClick={() => {
                  setSelectedMode(item.mode);
                  window.localStorage.setItem(STORAGE.mode, item.mode);
                }}
              >
                <span className="mode-number">{item.number}</span>
                <span className="mode-check">{selectedMode === item.mode ? "✓" : ""}</span>
                <b>{item.name}</b>
                <p>{item.copy}</p>
                <small>{item.meta}</small>
              </button>
            ))}
          </div>

          <div className="lobby-controls glass-panel">
            <div className="room-status">
              <span className="status-dot" />
              <div>
                <b>共享房间</b>
                <p>{roomMessage}</p>
              </div>
            </div>
            <button
              className="primary-button primary-button--wide"
              disabled={busy.start}
              onClick={() => void startGame(false)}
            >
              {busy.start ? "主持人正在抽题…" : "抽取一碗汤"}
              {!busy.start && <span>→</span>}
            </button>
            <div className="join-divider">
              <span>或加入已有游戏</span>
            </div>
            <form
              className="join-form"
              onSubmit={(event) => {
                event.preventDefault();
                void joinSession(joinId);
              }}
            >
              <label htmlFor="session-input">Session ID</label>
              <input
                id="session-input"
                value={joinId}
                onChange={(event) => setJoinId(event.target.value)}
                inputMode="numeric"
                placeholder="例如：21"
                autoComplete="off"
              />
              <button disabled={busy.join}>{busy.join ? "加入中…" : "加入"}</button>
            </form>
          </div>

          <p className="lobby-footnote">
            API 密钥、汤底与评分关键点只应保存在后端；独立前端不会接触这些秘密。
          </p>
        </section>
      )}

      {view === "game" && game && (
        <section className="game-screen page-enter">
          <div className="game-topline">
            <button
              className="back-button"
              onClick={() =>
                isRoundClosed(game)
                  ? returnToLobby()
                  : openDialog({ kind: "abandon" })
              }
              aria-label={isRoundClosed(game) ? "返回难度选择" : "离开本局"}
            >
              ←
            </button>
            <div className="session-chip">
              <span className={realSession ? "live-dot" : "demo-dot"} />
              <span>SESSION {game.session_id}</span>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(String(game.session_id));
                    toast("Session ID 已复制");
                  } catch {
                    toast(`Session ID：${game.session_id}`);
                  }
                }}
                aria-label="复制 Session ID"
                title="复制 Session ID"
              >
                ⧉
              </button>
            </div>
            <span className="sync-label">
              {pendingNext
                ? `下一题 ${pendingNext.session_id} 待进入`
                : settlementLocked
                  ? "结算已锁定"
                  : realSession
                    ? "自动同步中"
                    : "演示模式"}
            </span>
          </div>

          <article className="soup-card">
            <div className="soup-card-head">
              <div>
                <p className="eyebrow">TONIGHT&apos;S SOUP</p>
                <h1>《{game.title}》</h1>
              </div>
              <div className="badge-row">
                <span>{game.difficulty || "中等"}</span>
                <span>{modeNames[game.mode] || game.mode}</span>
              </div>
            </div>
            <p className="soup-face">{game.soup_face}</p>
            <div className="soup-card-foot">
              <span>主持人只回答：是 / 否 / 是也不是 / 无关</span>
              <button onClick={() => openDialog({ kind: "rules" })}>查看规则</button>
            </div>
          </article>

          <div className="resource-grid">
            <div className="resource-card">
              <span className="player-seal">人</span>
              <div>
                <small>{config.humanName}剩余</small>
                <b>{humanLeft == null ? "∞" : humanLeft}</b>
              </div>
              {humanSubmission && <em>已提交</em>}
            </div>
            <div className="resource-card">
              <span className="player-seal player-seal--ai">AI</span>
              <div>
                <small>{config.aiName}剩余</small>
                <b>{aiLeft == null ? "∞" : aiLeft}</b>
              </div>
              {partnerSubmission && <em>已提交</em>}
            </div>
            <div className="resource-card resource-card--hint">
              <span className="player-seal player-seal--hint">✦</span>
              <div>
                <small>阶梯提示</small>
                <b>
                  {hintsLeft == null ? "∞" : hintsLeft}
                  {game.hints_total != null && <i> / {game.hints_total}</i>}
                </b>
              </div>
              <em>已取 {game.hints_used}</em>
            </div>
          </div>

          <div className="action-grid">
            <button
              className="action-card action-card--ask"
              disabled={!canAsk}
              onClick={() => {
                setQuestionDraft("");
                openDialog({ kind: "ask" });
              }}
            >
              <span>?</span>
              <b>提问</b>
              <small>{humanSubmission ? "本方已提交" : "问一个是否问题"}</small>
            </button>
            <button
              className="action-card action-card--hint"
              disabled={!canHint}
              onClick={() => openDialog({ kind: "hint-confirm" })}
            >
              <span>✦</span>
              <b>提示</b>
              <small>{game.mode === "hard" ? "困难模式禁用" : "按阶梯取一条"}</small>
            </button>
            <button
              className="action-card action-card--submit"
              disabled={!humanSubmission && closed}
              onClick={() => {
                if (humanSubmission) showResult(config.humanId, true);
                else {
                  setTheoryDraft("");
                  openDialog({ kind: "submit" });
                }
              }}
            >
              <span>{humanSubmission ? "✓" : "↗"}</span>
              <b>{humanSubmission ? "已提交" : "提交"}</b>
              <small>{humanSubmission ? "查看评分和原文" : "完整推理与评分"}</small>
            </button>
          </div>

          <section className="log-panel glass-panel">
            <div className="log-head">
              <div>
                <p className="eyebrow">SHARED TIMELINE</p>
                <h2>共同推理记录</h2>
              </div>
              <span>{game.questions_log.length} 条</span>
            </div>
            <div className="log-list" ref={logRef}>
              {game.questions_log.length === 0 ? (
                <div className="empty-log">
                  <span>◎</span>
                  <p>第一条问题会出现在这里，网页和 AI 都能看到。</p>
                </div>
              ) : (
                game.questions_log.map((item, index) => {
                  const isQuestion = item.type === "question" || Boolean(item.question);
                  const isHint = item.type === "hint" || Boolean(item.hint);
                  const isSubmit = item.type === "submit" || Boolean(item.submitted_answer);
                  const label = isQuestion
                    ? playerName(item.player)
                    : isHint
                      ? "主持人提示"
                      : isSubmit
                        ? playerName(item.player || item.submitted_by)
                        : "主持人";
                  const content = String(
                    item.question || item.hint || item.text || item.answer || "",
                  );
                  return (
                    <article
                      className={`log-entry ${isHint ? "log-entry--hint" : ""} ${isSubmit ? "log-entry--submit" : ""}`}
                      key={String(item.request_id || `${index}-${content}`)}
                    >
                      <span className="log-avatar">
                        {isHint ? "✦" : isSubmit ? "✓" : label.slice(0, 1)}
                      </span>
                      <div className="log-content">
                        <div>
                          <b>{label}</b>
                          <time>{String(item.time || "")}</time>
                        </div>
                        <p>{content}</p>
                        {item.answer && (
                          <span className={`answer-pill ${answerClass(String(item.answer))}`}>
                            {String(item.answer)}
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          <div className="round-footer">
            <button
              className="footer-link footer-link--danger"
              disabled={closed}
              onClick={() => openDialog({ kind: "abandon" })}
            >
              放弃本局
            </button>
            <span>{roomMessage}</span>
            <button className="footer-link" onClick={() => showResult(undefined, true)}>
              {closed ? "查看结算" : "结束本局"}
            </button>
          </div>
        </section>
      )}

      {dialog.kind && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            className={`dialog-card dialog-card--${dialog.kind}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <button className="dialog-close" onClick={closeDialog} aria-label="关闭">
              ×
            </button>

            {dialog.kind === "rules" && (
              <>
                <p className="eyebrow">RULES AT A GLANCE</p>
                <h2 id="dialog-title">先把规则装进口袋</h2>
                <p className="dialog-lead">
                  主持人掌握汤底。玩家通过是否问题，逐步还原完整故事。
                </p>
                <div className="rule-list">
                  <div>
                    <b>01</b>
                    <span>
                      <strong>只问是否问题</strong>
                      <small>驳回不扣次数，并给出改写说明。</small>
                    </span>
                  </div>
                  <div>
                    <b>02</b>
                    <span>
                      <strong>提示逐层解锁</strong>
                      <small>大方向 → 收窄范围 → 接近答案。</small>
                    </span>
                  </div>
                  <div>
                    <b>03</b>
                    <span>
                      <strong>每人一次正式提交</strong>
                      <small>正常/困难模式提交后，本方剩余提问归零。</small>
                    </span>
                  </div>
                  <div>
                    <b>04</b>
                    <span>
                      <strong>结算不会自动跳题</strong>
                      <small>评分、推理原文与汤底会停留，直到手动进入下一题。</small>
                    </span>
                  </div>
                </div>
                <div className="score-formula">
                  <span>关键情节 40%</span>
                  <span>逻辑连贯 30%</span>
                  <span>细节还原 30%</span>
                </div>
                <button className="primary-button primary-button--wide" onClick={closeDialog}>
                  明白了，继续 <span>→</span>
                </button>
              </>
            )}

            {dialog.kind === "settings" && (
              <>
                <p className="eyebrow">CONNECTION SETTINGS</p>
                <h2 id="dialog-title">连接你的主持人</h2>
                <p className="dialog-lead">
                  设置只保存在本浏览器。密钥、汤底与评分关键点不要写进前端。
                </p>
                <div className="settings-grid">
                  <label className="field field--full">
                    <span>API 根地址</span>
                    <input
                      value={config.apiBase}
                      onChange={(event) =>
                        setConfig((value) => ({ ...value, apiBase: event.target.value }))
                      }
                      placeholder="/api/game"
                    />
                  </label>
                  <label className="field field--full">
                    <span>共享房间 key</span>
                    <input
                      value={config.roomKey}
                      onChange={(event) =>
                        setConfig((value) => ({ ...value, roomKey: event.target.value }))
                      }
                      placeholder="haiguitang-main"
                    />
                  </label>
                  <label className="field">
                    <span>人类玩家 ID</span>
                    <input
                      value={config.humanId}
                      onChange={(event) =>
                        setConfig((value) => ({ ...value, humanId: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>AI 玩家 ID</span>
                    <input
                      value={config.aiId}
                      onChange={(event) =>
                        setConfig((value) => ({ ...value, aiId: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>人类显示名</span>
                    <input
                      value={config.humanName}
                      onChange={(event) =>
                        setConfig((value) => ({ ...value, humanName: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>AI 显示名</span>
                    <input
                      value={config.aiName}
                      onChange={(event) =>
                        setConfig((value) => ({ ...value, aiName: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>轮询间隔（毫秒）</span>
                    <input
                      type="number"
                      min="1200"
                      step="100"
                      value={config.pollMs}
                      onChange={(event) =>
                        setConfig((value) => ({
                          ...value,
                          pollMs: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <div className="toggle-stack">
                    <label>
                      <input
                        type="checkbox"
                        checked={config.autoJoin}
                        onChange={(event) =>
                          setConfig((value) => ({
                            ...value,
                            autoJoin: event.target.checked,
                          }))
                        }
                      />
                      <span>自动寻找共享房间</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={config.fallbackDemo}
                        onChange={(event) =>
                          setConfig((value) => ({
                            ...value,
                            fallbackDemo: event.target.checked,
                          }))
                        }
                      />
                      <span>离线时进入演示模式</span>
                    </label>
                  </div>
                </div>
                <button className="primary-button primary-button--wide" onClick={saveSettings}>
                  保存连接设置 <span>→</span>
                </button>
              </>
            )}

            {dialog.kind === "ask" && game && (
              <>
                <p className="eyebrow">ASK THE HOST</p>
                <h2 id="dialog-title">问主持人一个问题</h2>
                <p className="dialog-lead">
                  {config.humanName}剩余 <b>{humanLeft == null ? "∞" : humanLeft}</b> 次。被驳回的问题不会扣次数。
                </p>
                <label className="field field--textarea">
                  <span>是否问题</span>
                  <textarea
                    autoFocus
                    maxLength={180}
                    value={questionDraft}
                    onChange={(event) => setQuestionDraft(event.target.value)}
                    placeholder="例如：这个人之前认识店主吗？"
                  />
                </label>
                <p className={`form-note ${dialog.error ? "form-note--error" : ""}`}>
                  {dialog.error || "问题应当能用“是 / 否 / 是也不是 / 无关”回答。"}
                </p>
                <button
                  className="primary-button primary-button--wide"
                  disabled={busy.ask || !questionDraft.trim()}
                  onClick={() => void submitQuestion()}
                >
                  {busy.ask ? "主持人判断中…" : dialog.error ? "修改后重新提交" : "递给主持人"}
                  {!busy.ask && <span>→</span>}
                </button>
              </>
            )}

            {dialog.kind === "hint-confirm" && game && (
              <div className="center-dialog">
                <div className="hint-orb">✦</div>
                <p className="eyebrow">HINT LADDER</p>
                <h2 id="dialog-title">取第 {game.hints_used + 1} 级提示？</h2>
                <p className="dialog-lead">
                  提示会从大方向逐步接近答案；上一层取出后，下一层才会解锁。
                </p>
                {dialog.error && <p className="form-note form-note--error">{dialog.error}</p>}
                <button
                  className="primary-button primary-button--wide"
                  disabled={busy.hint}
                  onClick={() => void takeHint()}
                >
                  {busy.hint ? "正在拆开线索…" : "取出这条提示"}
                  {!busy.hint && <span>→</span>}
                </button>
              </div>
            )}

            {dialog.kind === "hint-result" && (
              <div className="center-dialog">
                <div className="hint-orb hint-orb--open">✦</div>
                <p className="eyebrow">HINT {dialog.hintIndex || ""}</p>
                <h2 id="dialog-title">
                  {dialog.remote ? "搭档取出了一条提示" : "主持人递来一条线索"}
                </h2>
                <div className="hint-paper">{dialog.hint}</div>
                <button className="primary-button primary-button--wide" onClick={closeDialog}>
                  记下这条提示 <span>→</span>
                </button>
              </div>
            )}

            {dialog.kind === "submit" && game && (
              <>
                <p className="eyebrow">FINAL THEORY · {config.humanName}</p>
                <h2 id="dialog-title">把故事完整地拼起来</h2>
                <p className="submit-warning">
                  <b>提交后：</b>
                  {game.mode === "easy"
                    ? "本局每位玩家只有一次正式提交机会。"
                    : `${config.humanName}的剩余提问将归零；未满 90 分时，搭档仍可继续。`}
                </p>
                <label className="field field--textarea field--theory">
                  <span>完整推理</span>
                  <textarea
                    autoFocus
                    maxLength={1200}
                    value={theoryDraft}
                    onChange={(event) => setTheoryDraft(event.target.value)}
                    placeholder="请写出人物关系、事件经过、原因与关键细节……"
                  />
                </label>
                <p className={`form-note ${dialog.error ? "form-note--error" : ""}`}>
                  {dialog.error || "建议至少包含：动机、因果和关键转折。"}
                </p>
                <button
                  className="primary-button primary-button--wide"
                  disabled={busy.submit}
                  onClick={() => void submitTheory()}
                >
                  {busy.submit ? "主持人评分中…" : dialog.error ? "重新提交并评分" : "确认提交并评分"}
                  {!busy.submit && <span>→</span>}
                </button>
              </>
            )}

            {dialog.kind === "result" && game && (
              <div className="result-dialog">
                {resultSubmission ? (
                  <>
                    <div className="score-orb">
                      <b>{resultSubmission.total}</b>
                      <small>综合评分</small>
                    </div>
                    <p className="eyebrow">HOST&apos;S VERDICT</p>
                    <h2 id="dialog-title">{resultSubmission.rank}</h2>
                    <p className="dialog-lead">
                      {playerName(resultSubmission.player)}本次提交获得 {resultSubmission.total} 分。
                    </p>
                    <ScoreRow label="关键情节" weight="40%" value={resultSubmission.key_plot} />
                    <ScoreRow label="逻辑连贯" weight="30%" value={resultSubmission.logic} />
                    <ScoreRow label="细节还原" weight="30%" value={resultSubmission.detail} />
                    {resultSubmission.comment && (
                      <p className="host-comment">
                        <b>主持人评语：</b>
                        {resultSubmission.comment}
                      </p>
                    )}
                    {resultSubmission.answer && (
                      <details className="theory-record" open>
                        <summary>提交的推理原文</summary>
                        <p>{resultSubmission.answer}</p>
                      </details>
                    )}
                  </>
                ) : (
                  <>
                    <div className="score-orb score-orb--empty">—</div>
                    <p className="eyebrow">END THIS ROUND</p>
                    <h2 id="dialog-title">本局还没有正式提交</h2>
                    <p className="dialog-lead">
                      没有提交内容，因此暂时没有评分。你可以返回继续推理，或查看汤底结束本局。
                    </p>
                  </>
                )}

                {game.soup_bottom_revealed ? (
                  <div className="bottom-paper">
                    <b>原汤底</b>
                    <p>{game.soup_bottom || "后端尚未返回原汤底。"}</p>
                  </div>
                ) : (
                  <button
                    className="reveal-button"
                    disabled={busy.reveal}
                    onClick={() => void revealBottom()}
                  >
                    {busy.reveal ? "正在揭开汤底…" : "查看原汤底（会结束本局）"}
                  </button>
                )}

                {pendingNext && String(pendingNext.session_id) !== String(game.session_id) && (
                  <p className="next-ready-note">
                    {config.aiName}或另一端已准备好 Session {pendingNext.session_id}。当前结算会保留，点击后才进入。
                  </p>
                )}

                <div className="result-actions">
                  {!closed ? (
                    <>
                      <button className="secondary-button" onClick={closeDialog}>
                        继续本局
                      </button>
                      <button className="primary-button" onClick={() => void revealBottom()}>
                        结束并揭底 <span>→</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="secondary-button" onClick={closeDialog}>
                        留在本局复盘
                      </button>
                      <button
                        className="primary-button"
                        disabled={busy.start || busy.join}
                        onClick={() => void proceedToNext()}
                      >
                        {pendingNext
                          ? `进入下一题 · ${pendingNext.session_id}`
                          : busy.start
                            ? "主持人正在抽题…"
                            : "抽取下一题"}
                        {!busy.start && !busy.join && <span>→</span>}
                      </button>
                    </>
                  )}
                </div>
                {closed && (
                  <button className="text-button result-mode-link" onClick={returnToLobby}>
                    返回难度选择
                  </button>
                )}
              </div>
            )}

            {dialog.kind === "abandon" && game && (
              <>
                <p className="eyebrow">LEAVE WITHOUT SETTLEMENT</p>
                <h2 id="dialog-title">确定放弃本局？</h2>
                <p className="submit-warning">
                  <b>放弃不会结算：</b>
                  不显示评分、不公开汤底，并直接离开 Session {game.session_id}。
                </p>
                <p className={`form-note ${dialog.error ? "form-note--error" : ""}`}>
                  {dialog.error || "如果只是想看评分或汤底，请关闭这里并点“结束本局”。"}
                </p>
                <div className="result-actions">
                  <button className="secondary-button" onClick={closeDialog}>
                    继续推理
                  </button>
                  <button
                    className="danger-button"
                    disabled={busy.abandon}
                    onClick={() => void abandonRound()}
                  >
                    {busy.abandon ? "正在退出…" : "确认放弃"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <div className={`toast ${toastMessage ? "toast--visible" : ""}`} aria-live="polite">
        {toastMessage}
      </div>

      <footer className="site-footer">
        <span>HAIGUITANG · OPEN CO-OP FRONTEND</span>
        <span>界面状态以共享后端 Session 为准</span>
      </footer>
    </main>
  );
}

function ScoreRow({
  label,
  weight,
  value,
}: {
  label: string;
  weight: string;
  value: number;
}) {
  const safeValue = clampScore(value);
  return (
    <div className="score-row">
      <div>
        <span>
          {label} <small>{weight}</small>
        </span>
        <b>{Math.round(safeValue)}</b>
      </div>
      <i>
        <em style={{ width: `${safeValue}%` }} />
      </i>
    </div>
  );
}
