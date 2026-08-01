import { a as require_react, o as __toESM, t as require_jsx_runtime } from "../index.js";
//#region lib/game.ts
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
var record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
var finite = (value, fallback = 0) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};
var text = (value) => value == null ? "" : String(value);
var createRequestId = () => globalThis.crypto?.randomUUID?.() ?? `haiguitang-${Date.now()}-${Math.random().toString(16).slice(2)}`;
var modeNames = {
	easy: "轻松",
	normal: "正常",
	hard: "困难"
};
var rankFromScore = (score) => score >= 90 ? "完全还原" : score >= 70 ? "基本还原" : score >= 50 ? "部分还原" : "方向错误";
var isRoundClosed = (state) => Boolean(state && (state.status !== "playing" || state.soup_bottom_revealed === true));
function hintText(value) {
	if (typeof value === "string") return value.trim();
	const valueRecord = record(value);
	return text(valueRecord.hint ?? valueRecord.hint_content ?? valueRecord.hint_text ?? valueRecord.content ?? valueRecord.text).trim();
}
function collectHints(data, previous) {
	const result = [];
	const seen = /* @__PURE__ */ new Set();
	const append = (value, fallbackIndex) => {
		const content = hintText(value);
		if (!content || seen.has(content)) return;
		const valueRecord = record(value);
		seen.add(content);
		result.push({
			index: finite(valueRecord.index ?? valueRecord.level ?? valueRecord.hint_index ?? fallbackIndex, result.length + 1),
			text: content,
			player: text(valueRecord.player ?? valueRecord.requested_by),
			time: text(valueRecord.time ?? valueRecord.created_at)
		});
	};
	previous?.revealed_hints.forEach((item, index) => append(item, index + 1));
	[
		data.revealed_hints,
		data.hints_log,
		data.hint_history,
		data.used_hints
	].forEach((list) => {
		if (Array.isArray(list)) list.forEach((item, index) => append(item, index + 1));
	});
	[
		data.hint,
		data.hint_content,
		data.hint_text,
		data.latest_hint,
		data.current_hint
	].forEach((item) => append(item));
	return result;
}
function normalizeSubmission(raw, player, previous) {
	if (raw == null || raw === false) return null;
	const rawRecord = raw === true ? {} : record(raw);
	const scoreRecord = record(rawRecord.score);
	const detailRecord = record(rawRecord.score_detail ?? rawRecord.detail_breakdown ?? (typeof rawRecord.detail === "object" ? rawRecord.detail : void 0) ?? scoreRecord.detail);
	const total = finite(rawRecord.total ?? (typeof rawRecord.score === "number" ? rawRecord.score : void 0) ?? rawRecord.overall ?? scoreRecord.total ?? scoreRecord.overall, previous?.total ?? 0);
	return {
		...previous,
		...rawRecord,
		submitted: true,
		player: text(rawRecord.player ?? rawRecord.submitted_by ?? player),
		total,
		rank: text(rawRecord.rank ?? scoreRecord.rank ?? previous?.rank) || rankFromScore(total),
		key_plot: finite(rawRecord.key_plot ?? detailRecord.key_plot ?? scoreRecord.key_plot, previous?.key_plot ?? 0),
		logic: finite(rawRecord.logic ?? detailRecord.logic ?? scoreRecord.logic, previous?.logic ?? 0),
		detail: finite((typeof rawRecord.detail === "number" ? rawRecord.detail : void 0) ?? detailRecord.detail ?? scoreRecord.detail, previous?.detail ?? 0),
		comment: text(rawRecord.comment ?? scoreRecord.comment ?? previous?.comment),
		answer: text(rawRecord.submitted_answer ?? rawRecord.answer_text ?? rawRecord.answer ?? previous?.answer),
		request_id: text(rawRecord.request_id ?? previous?.request_id) || void 0,
		submitted_at: text(rawRecord.submitted_at ?? rawRecord.time ?? previous?.submitted_at) || void 0
	};
}
function collectSubmissions(data, previous) {
	const result = {};
	const append = (player, value) => {
		if (!player) return;
		const normalized = normalizeSubmission(value, player, result[player]);
		if (normalized) result[player] = normalized;
	};
	Object.entries(previous?.submissions ?? {}).forEach(([player, value]) => append(player, value));
	if (Array.isArray(data.submissions)) data.submissions.forEach((value) => {
		const valueRecord = record(value);
		append(text(valueRecord.player ?? valueRecord.submitted_by), value);
	});
	else Object.entries(record(data.submissions)).forEach(([player, value]) => append(player, value));
	const nested = record(data.submission ?? data.last_submission);
	const flatPlayer = text(data.submitted_by ?? nested.player);
	if (Boolean(flatPlayer && (data.submitted === true || data.submitted_answer != null || data.score != null || data.score_detail != null))) append(flatPlayer, {
		submitted_by: flatPlayer,
		submitted_answer: data.submitted_answer,
		score: data.score,
		score_detail: data.score_detail ?? data.detail,
		rank: data.rank,
		comment: data.comment,
		request_id: data.request_id
	});
	return result;
}
var inferredLogType = (item) => item.type || (item.hint ? "hint" : item.question ? "question" : item.submitted_answer ? "submit" : "system");
var logSignature = (item) => item.request_id || [
	inferredLogType(item),
	item.player || item.submitted_by || "",
	item.question || item.hint || item.text || item.submitted_answer || "",
	item.answer || ""
].join("|");
function mergeLogs(data, previous, hints, submissions) {
	const incoming = Array.isArray(data.questions_log) ? data.questions_log : [];
	const kept = previous?.questions_log ?? [];
	const result = [];
	const known = /* @__PURE__ */ new Set();
	const append = (item) => {
		const key = logSignature(item);
		if (known.has(key)) return;
		known.add(key);
		result.push(item);
	};
	incoming.forEach(append);
	kept.forEach(append);
	const hintTexts = new Set(result.filter((item) => inferredLogType(item) === "hint").map((item) => hintText(item)));
	hints.forEach((item) => {
		if (hintTexts.has(item.text)) return;
		append({
			type: "hint",
			hint: item.text,
			text: item.text,
			player: item.player,
			time: item.time
		});
		hintTexts.add(item.text);
	});
	const submittedPlayers = new Set(result.filter((item) => inferredLogType(item) === "submit").map((item) => text(item.player ?? item.submitted_by)));
	Object.entries(submissions).forEach(([player, submission]) => {
		if (submittedPlayers.has(player)) return;
		append({
			type: "submit",
			player,
			text: `已提交完整推理 · ${submission.total} 分 ${submission.rank}`,
			time: submission.submitted_at,
			request_id: submission.request_id || `submission-${player}`
		});
	});
	return result;
}
function readQuestionLeft(data, previous, player) {
	const incoming = record(data.questions_left)[player] ?? data[`${player}_questions_left`];
	if (incoming === null) return null;
	if (incoming != null && Number.isFinite(Number(incoming))) {
		const incomingNumber = Number(incoming);
		const previousValue = previous?.questions_left[player];
		return typeof previousValue === "number" ? Math.min(previousValue, incomingNumber) : incomingNumber;
	}
	return previous?.questions_left[player] ?? null;
}
function normalizeState(raw, previous, mode, players) {
	const data = record(raw);
	const hints = collectHints(data, previous);
	const incomingUsed = finite(data.hints_used, 0);
	const hintsUsed = Array.isArray(data.revealed_hints) || Array.isArray(data.hints_log) || Array.isArray(data.hint_history) || Array.isArray(data.used_hints) || data.hint != null || data.hint_content != null || data.hint_text != null || data.latest_hint != null || data.current_hint != null || hints.length > 0 ? hints.length : Math.max(incomingUsed, previous?.hints_used ?? 0);
	const submissions = collectSubmissions(data, previous);
	const revealed = Boolean(data.soup_bottom_revealed || data.revealed || previous?.soup_bottom_revealed);
	const resolvedMode = data.mode ?? previous?.mode ?? mode;
	const incomingStatus = text(data.status ?? previous?.status ?? "playing");
	const resolvedStatus = previous && isRoundClosed(previous) && incomingStatus === "playing" ? previous.status : incomingStatus;
	const hintsTotal = data.hints_total === null ? null : data.hints_total != null ? finite(data.hints_total, previous?.hints_total ?? 0) : previous?.hints_total !== void 0 ? previous.hints_total : resolvedMode === "easy" ? null : 0;
	const questionsLeft = {
		...previous?.questions_left ?? {},
		...record(data.questions_left),
		[players.humanId]: readQuestionLeft(data, previous, players.humanId),
		[players.aiId]: readQuestionLeft(data, previous, players.aiId)
	};
	const state = {
		...previous ?? {},
		...data,
		session_id: data.session_id ?? previous?.session_id ?? "",
		status: resolvedStatus,
		title: text(data.title ?? previous?.title ?? "未命名汤"),
		soup_face: text(data.soup_face ?? previous?.soup_face),
		soup_bottom: text(data.soup_bottom ?? previous?.soup_bottom) || void 0,
		soup_bottom_revealed: revealed,
		difficulty: text(data.difficulty ?? previous?.difficulty ?? "中等"),
		mode: resolvedMode,
		current_player: text(data.current_player ?? previous?.current_player) || void 0,
		questions_left: questionsLeft,
		hints_used: hintsUsed,
		hints_total: hintsTotal,
		revealed_hints: hints,
		questions_log: [],
		submissions,
		room_key: text(data.room_key ?? previous?.room_key) || void 0
	};
	state.questions_log = mergeLogs(data, previous, hints, submissions);
	return state;
}
function appendLogIfMissing(state, item) {
	const key = logSignature(item);
	if (state.questions_log.some((entry) => logSignature(entry) === key)) return state;
	return {
		...state,
		questions_log: [...state.questions_log, item]
	};
}
var bestSubmission = (state) => Object.values(state?.submissions ?? {}).sort((a, b) => b.total - a.total)[0] ?? null;
function demoState(mode, players) {
	const questionLimit = mode === "easy" ? null : mode === "normal" ? 6 : 3;
	return {
		session_id: `demo-${Date.now()}`,
		status: "playing",
		title: "未亮的灯",
		difficulty: "中等",
		mode,
		soup_face: "面包店每天关门后都会在门边留一盏灯。某天夜里，灯没有亮，店主第二天却很高兴。为什么？",
		soup_bottom: "灯是给清晨送货的人看的约定信号。灯亮表示还有前一天预留的面包没有被取走；那晚灯没亮，说明所有预留都按时取走了，所以店主很高兴。",
		soup_bottom_revealed: false,
		questions_left: {
			[players.humanId]: questionLimit,
			[players.aiId]: questionLimit
		},
		hints_used: 0,
		hints_total: mode === "hard" ? 0 : mode === "easy" ? null : 3,
		revealed_hints: [],
		questions_log: [{
			type: "system",
			text: `主持人已放出汤面 · ${modeNames[mode]}模式`,
			time: (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", {
				hour: "2-digit",
				minute: "2-digit",
				hour12: false
			})
		}],
		submissions: {}
	};
}
var demoHints = [
	"先别追究店主为什么开心，想想这盏灯是给谁看的。",
	"灯不是照明工具，而是一种只有固定的人才懂的信号。",
	"灯亮代表还有东西没有被取走；不亮反而说明约定完成了。"
];
function demoAnswer(question) {
	if (!/吗[？?]?$|是否|是不是|有无|能否|会不会|有没有|可不可以|对不对/.test(question)) return {
		answer: "驳回",
		reason: "这个问题不能直接用是或否回答。可以改成：“这盏灯是给固定的人看的吗？”"
	};
	if (/固定|熟悉|认识|约定|信号/.test(question)) return { answer: "是" };
	if (/照明|坏|故障|忘/.test(question)) return { answer: "否" };
	if (/顾客|客人|取|东西|面包/.test(question)) return { answer: "是也不是" };
	return { answer: "无关" };
}
//#endregion
//#region app/page.tsx
var import_jsx_runtime = require_jsx_runtime();
var STORAGE = {
	config: "haiguitang_open_config_v1",
	state: "haiguitang_open_state_v1",
	session: "haiguitang_open_session_v1",
	mode: "haiguitang_open_mode_v1",
	settlement: "haiguitang_open_settlement_v1",
	left: "haiguitang_open_left_sessions_v1",
	rules: "haiguitang_open_rules_seen_v1"
};
var DEFAULT_CONFIG = {
	apiBase: process.env.NEXT_PUBLIC_TURTLE_API_BASE || "/api/game",
	roomKey: process.env.NEXT_PUBLIC_TURTLE_ROOM_KEY || "haiguitang-main",
	pollMs: 3e3,
	fallbackDemo: true,
	autoJoin: true,
	humanId: "xinxin",
	aiId: "azhi",
	humanName: "玩家",
	aiName: "AI 搭档"
};
var now = () => (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", {
	hour: "2-digit",
	minute: "2-digit",
	hour12: false
});
var clampScore = (value) => Math.max(0, Math.min(100, value));
function loadJson(key, fallback) {
	if (typeof window === "undefined") return fallback;
	try {
		const raw = window.localStorage.getItem(key);
		return raw ? JSON.parse(raw) : fallback;
	} catch {
		return fallback;
	}
}
function answerClass(answer) {
	if (answer === "是") return "answer--yes";
	if (answer === "否") return "answer--no";
	if (answer === "是也不是") return "answer--mixed";
	if (answer === "驳回") return "answer--reject";
	return "answer--neutral";
}
function Home() {
	const [config, setConfig] = (0, import_react.useState)(() => loadJson(STORAGE.config, DEFAULT_CONFIG));
	const [view, setView] = (0, import_react.useState)("welcome");
	const [selectedMode, setSelectedMode] = (0, import_react.useState)(() => {
		if (typeof window === "undefined") return "normal";
		const saved = window.localStorage.getItem(STORAGE.mode);
		return saved === "easy" || saved === "hard" ? saved : "normal";
	});
	const [game, setGame] = (0, import_react.useState)(null);
	const [realSession, setRealSession] = (0, import_react.useState)(false);
	const [pendingNext, setPendingNext] = (0, import_react.useState)(null);
	const [settlementLocked, setSettlementLocked] = (0, import_react.useState)(false);
	const [dialog, setDialog] = (0, import_react.useState)({ kind: null });
	const [toastMessage, setToastMessage] = (0, import_react.useState)("");
	const [roomMessage, setRoomMessage] = (0, import_react.useState)("会自动寻找同一房间里由网页或 AI 开始的游戏。");
	const [joinId, setJoinId] = (0, import_react.useState)("");
	const [questionDraft, setQuestionDraft] = (0, import_react.useState)("");
	const [theoryDraft, setTheoryDraft] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)({
		start: false,
		join: false,
		ask: false,
		hint: false,
		submit: false,
		reveal: false,
		abandon: false
	});
	const gameRef = (0, import_react.useRef)(null);
	const configRef = (0, import_react.useRef)(config);
	const dialogRef = (0, import_react.useRef)(dialog);
	const realSessionRef = (0, import_react.useRef)(false);
	const pendingNextRef = (0, import_react.useRef)(null);
	const pollBusyRef = (0, import_react.useRef)(false);
	const bootedRef = (0, import_react.useRef)(false);
	const toastTimerRef = (0, import_react.useRef)(null);
	const pendingRequestsRef = (0, import_react.useRef)({});
	const settlementPresentedRef = (0, import_react.useRef)(null);
	const queuedSettlementRef = (0, import_react.useRef)(null);
	const activeSyncPausedRef = (0, import_react.useRef)(false);
	const activeSyncResumeTimerRef = (0, import_react.useRef)(null);
	const logRef = (0, import_react.useRef)(null);
	const playerName = (player) => {
		if (player === config.aiId) return config.aiName;
		if (player === config.humanId) return config.humanName;
		return player || "主持人";
	};
	const commitGame = (next, isReal = realSessionRef.current) => {
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
	const setPending = (next) => {
		pendingNextRef.current = next;
		setPendingNext(next);
	};
	const holdSettlement = (sessionId) => {
		window.localStorage.setItem(STORAGE.settlement, String(sessionId));
		setSettlementLocked(true);
	};
	const releaseSettlement = () => {
		window.localStorage.removeItem(STORAGE.settlement);
		setSettlementLocked(false);
	};
	const settlementHeld = (state) => Boolean(state?.session_id && window.localStorage.getItem(STORAGE.settlement) === String(state.session_id));
	const leftSessions = () => loadJson(STORAGE.left, []).map(String);
	const markLeft = (sessionId) => {
		if (sessionId == null) return;
		const next = leftSessions().filter((id) => id !== String(sessionId));
		next.push(String(sessionId));
		window.localStorage.setItem(STORAGE.left, JSON.stringify(next.slice(-20)));
	};
	const unmarkLeft = (sessionId) => {
		if (sessionId == null) return;
		window.localStorage.setItem(STORAGE.left, JSON.stringify(leftSessions().filter((id) => id !== String(sessionId))));
	};
	const toast = (message) => {
		setToastMessage(message);
		if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
		toastTimerRef.current = setTimeout(() => setToastMessage(""), 2800);
	};
	const changeView = (next) => {
		setView((current) => {
			if (current !== next) requestAnimationFrame(() => window.scrollTo({
				top: 0,
				behavior: "auto"
			}));
			return next;
		});
	};
	const openDialog = (next) => {
		dialogRef.current = next;
		setDialog(next);
	};
	const closeDialog = () => {
		dialogRef.current = { kind: null };
		setDialog({ kind: null });
		const queued = queuedSettlementRef.current;
		queuedSettlementRef.current = null;
		if (queued && gameRef.current && String(gameRef.current.session_id) === queued && isRoundClosed(gameRef.current)) setTimeout(() => showResult(void 0, true), 0);
	};
	const request = async (path, method = "GET", body) => {
		const base = configRef.current.apiBase.replace(/\/$/, "");
		let response;
		try {
			response = await fetch(`${base}${path}`, {
				method,
				headers: { "Content-Type": "application/json" },
				body: body ? JSON.stringify(body) : void 0,
				cache: "no-store"
			});
		} catch (cause) {
			const error = /* @__PURE__ */ new Error("无法连接主持人，请检查 API 地址与 HTTPS/CORS 配置。");
			error.cause = cause;
			throw error;
		}
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			const error = new Error(String(data.error || data.reason || `主持人暂时没有回应（${response.status}）`));
			error.status = response.status;
			error.data = data;
			throw error;
		}
		return data;
	};
	const requestIdFor = (key) => {
		if (!pendingRequestsRef.current[key]) pendingRequestsRef.current[key] = createRequestId();
		return pendingRequestsRef.current[key];
	};
	const clearRequestId = (key) => {
		delete pendingRequestsRef.current[key];
	};
	const showResult = (player, force = false) => {
		const current = gameRef.current;
		if (!current) return;
		const sessionId = String(current.session_id);
		if (isRoundClosed(current)) holdSettlement(current.session_id);
		if (!force && dialogRef.current.kind && dialogRef.current.kind !== "result") {
			queuedSettlementRef.current = sessionId;
			toast("本局已进入结算，关闭当前弹窗后会显示结果");
			return;
		}
		settlementPresentedRef.current = sessionId;
		openDialog({
			kind: "result",
			player
		});
	};
	const presentSettlementIfNeeded = (previous, next) => {
		if (!isRoundClosed(next)) return;
		holdSettlement(next.session_id);
		const sessionId = String(next.session_id);
		if (previous && String(previous.session_id) === sessionId && isRoundClosed(previous) || settlementPresentedRef.current === sessionId) return;
		showResult(void 0, false);
	};
	const discoverActive = async (silent = true, allowSwitch = false) => {
		try {
			const data = await request(`/active?room_key=${encodeURIComponent(configRef.current.roomKey)}`);
			if (!data.session_id) return false;
			const current = gameRef.current;
			const same = current?.session_id != null && String(current.session_id) === String(data.session_id);
			const normalized = normalizeState(data, same ? current ?? void 0 : void 0, selectedMode, {
				humanId: configRef.current.humanId,
				aiId: configRef.current.aiId
			});
			if (current && !same && (isRoundClosed(current) || settlementHeld(current)) && !allowSwitch) {
				setPending(normalized);
				setRoomMessage(`下一题 Session ${normalized.session_id} 已准备好，当前结算会保留到你手动进入。`);
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
			if (!silent) setRoomMessage("当前没有活跃游戏，也可以粘贴 session_id 加入。");
			return false;
		}
	};
	const activateSession = async (sessionId) => {
		try {
			await request("/activate", "POST", {
				session_id: sessionId,
				room_key: configRef.current.roomKey,
				player: configRef.current.humanId,
				source: "standalone-web",
				request_id: createRequestId()
			});
			return true;
		} catch (error) {
			const apiError = error;
			if (apiError.status === 404 || apiError.status === 405) {
				activeSyncPausedRef.current = true;
				if (activeSyncResumeTimerRef.current) clearTimeout(activeSyncResumeTimerRef.current);
				activeSyncResumeTimerRef.current = setTimeout(() => {
					activeSyncPausedRef.current = false;
				}, 3e4);
				return false;
			}
			throw error;
		}
	};
	const joinSession = async (rawId, options = {}) => {
		const sessionId = String(rawId).trim();
		if (!sessionId || busy.join) {
			if (!sessionId) toast("请先输入 Session ID");
			return false;
		}
		setBusy((value) => ({
			...value,
			join: true
		}));
		try {
			const normalized = normalizeState(await request(`/status?session_id=${encodeURIComponent(sessionId)}`), gameRef.current?.session_id != null && String(gameRef.current.session_id) === sessionId ? gameRef.current : void 0, selectedMode, {
				humanId: configRef.current.humanId,
				aiId: configRef.current.aiId
			});
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
			setRoomMessage(activated ? `已加入并同步 Session ${normalized.session_id}` : `已加入 Session ${normalized.session_id}；后端尚未提供 /activate`);
			if (!options.silent) toast("游戏已同步");
			presentSettlementIfNeeded(null, normalized);
			return true;
		} catch (error) {
			if (!options.silent) toast(error.message || "没有找到这个游戏");
			return false;
		} finally {
			setBusy((value) => ({
				...value,
				join: false
			}));
		}
	};
	const startGame = async (forceNew = false, mode = selectedMode) => {
		if (busy.start) return;
		setBusy((value) => ({
			...value,
			start: true
		}));
		const key = `start:${mode}:${forceNew}:${configRef.current.roomKey}`;
		try {
			const normalized = normalizeState(await request("/start", "POST", {
				mode,
				room_key: configRef.current.roomKey,
				reuse_active: !forceNew,
				force_new: forceNew,
				player: configRef.current.humanId,
				source: "standalone-web",
				request_id: requestIdFor(key)
			}), void 0, mode, {
				humanId: configRef.current.humanId,
				aiId: configRef.current.aiId
			});
			if (forceNew && leftSessions().includes(String(normalized.session_id))) {
				const conflict = /* @__PURE__ */ new Error(`后端仍返回已离开的旧 Session ${normalized.session_id}，请确认 force_new=true 会创建新局。`);
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
			const apiError = error;
			if (!(configRef.current.fallbackDemo && !apiError.noDemo && (!apiError.status || apiError.status === 404 || apiError.status === 405 || apiError.status >= 500))) {
				toast(apiError.message || "无法开始游戏");
				return;
			}
			const fallback = demoState(mode, {
				humanId: configRef.current.humanId,
				aiId: configRef.current.aiId
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
			setBusy((value) => ({
				...value,
				start: false
			}));
		}
	};
	const syncCurrent = async () => {
		if (pollBusyRef.current || !realSessionRef.current) return;
		const current = gameRef.current;
		if (!current?.session_id) return;
		pollBusyRef.current = true;
		try {
			const sessionId = current.session_id;
			const data = await request(`/status?session_id=${encodeURIComponent(sessionId)}`);
			if (!gameRef.current || String(gameRef.current.session_id) !== String(sessionId)) return;
			const previous = gameRef.current;
			const normalized = normalizeState(data, previous, selectedMode, {
				humanId: configRef.current.humanId,
				aiId: configRef.current.aiId
			});
			commitGame(normalized, true);
			const oldHints = new Set(previous.revealed_hints.map((item) => item.text));
			const freshHints = normalized.revealed_hints.filter((item) => !oldHints.has(item.text));
			if (freshHints.length) {
				const latest = freshHints[freshHints.length - 1];
				if (!dialogRef.current.kind) openDialog({
					kind: "hint-result",
					hint: latest.text,
					hintIndex: latest.index,
					remote: true
				});
				else toast("新提示已同步到共同推理记录");
			}
			presentSettlementIfNeeded(previous, normalized);
			if (configRef.current.autoJoin && !activeSyncPausedRef.current) await discoverActive(true, false);
		} catch {} finally {
			pollBusyRef.current = false;
		}
	};
	const submitQuestion = async () => {
		const current = gameRef.current;
		const question = questionDraft.trim();
		if (!current || !question || busy.ask) return;
		const key = `ask:${current.session_id}:${question}`;
		const requestId = requestIdFor(key);
		setBusy((value) => ({
			...value,
			ask: true
		}));
		try {
			let answer = "";
			let reason = "";
			let next = current;
			if (realSessionRef.current) {
				const data = await request("/ask", "POST", {
					session_id: current.session_id,
					player: configRef.current.humanId,
					source: "standalone-web",
					request_id: requestId,
					question
				});
				if (!gameRef.current || String(gameRef.current.session_id) !== String(current.session_id)) {
					toast("房间已切换，旧房间的回答不会写入新局");
					return;
				}
				answer = String(data.answer || "是也不是");
				reason = String(data.reason || "");
				next = normalizeState(data, current, selectedMode, {
					humanId: configRef.current.humanId,
					aiId: configRef.current.aiId
				});
			} else {
				const result = demoAnswer(question);
				answer = result.answer;
				reason = result.reason || "";
				if (answer !== "驳回") next = {
					...current,
					questions_left: {
						...current.questions_left,
						[configRef.current.humanId]: current.questions_left[configRef.current.humanId] == null ? null : Math.max(0, Number(current.questions_left[configRef.current.humanId]) - 1)
					}
				};
			}
			if (!next.questions_log.some((item) => item.player === configRef.current.humanId && (item.question || item.text) === question && item.answer === answer)) next = appendLogIfMissing(next, {
				type: "question",
				player: configRef.current.humanId,
				source: "standalone-web",
				request_id: requestId,
				question,
				text: question,
				answer,
				time: now()
			});
			commitGame(next);
			clearRequestId(key);
			if (answer === "驳回") openDialog({
				kind: "ask",
				error: reason || "请改成能用是或否回答的问题。"
			});
			else {
				setQuestionDraft("");
				closeDialog();
				toast(`主持人回答：${answer}`);
			}
		} catch (error) {
			openDialog({
				kind: "ask",
				error: error.message
			});
		} finally {
			setBusy((value) => ({
				...value,
				ask: false
			}));
		}
	};
	const takeHint = async () => {
		const current = gameRef.current;
		if (!current || busy.hint) return;
		const expectedIndex = current.hints_used + 1;
		const key = `hint:${current.session_id}:${expectedIndex}`;
		const requestId = requestIdFor(key);
		setBusy((value) => ({
			...value,
			hint: true
		}));
		try {
			let content = "";
			let next = current;
			if (realSessionRef.current) {
				const data = await request("/hint", "POST", {
					session_id: current.session_id,
					player: configRef.current.humanId,
					source: "standalone-web",
					request_id: requestId
				});
				if (!gameRef.current || String(gameRef.current.session_id) !== String(current.session_id)) {
					toast("房间已切换，旧房间的提示不会写入新局");
					return;
				}
				content = hintText(data.hint) || hintText(data.hint_content) || hintText(data.hint_text) || hintText(data.content) || hintText(data.latest_hint);
				next = normalizeState(data, current, selectedMode, {
					humanId: configRef.current.humanId,
					aiId: configRef.current.aiId
				});
			} else {
				content = demoHints[Math.min(current.hints_used, demoHints.length - 1)];
				next = normalizeState({
					hints_used: current.hints_used + 1,
					revealed_hints: [...current.revealed_hints, {
						index: expectedIndex,
						hint: content,
						player: configRef.current.humanId,
						time: now()
					}]
				}, current, selectedMode, {
					humanId: configRef.current.humanId,
					aiId: configRef.current.aiId
				});
			}
			if (!content) content = next.revealed_hints.find((item) => item.index === expectedIndex)?.text || "";
			commitGame(next);
			clearRequestId(key);
			if (content) openDialog({
				kind: "hint-result",
				hint: content,
				hintIndex: expectedIndex
			});
			else {
				closeDialog();
				toast("提示已计数，但后端没有返回提示内容");
			}
		} catch (error) {
			openDialog({
				kind: "hint-confirm",
				error: error.message
			});
		} finally {
			setBusy((value) => ({
				...value,
				hint: false
			}));
		}
	};
	const submitTheory = async () => {
		const current = gameRef.current;
		const answerText = theoryDraft.trim();
		if (!current || busy.submit) return;
		if (answerText.length < 8) {
			openDialog({
				kind: "submit",
				error: "请先写出较完整的推理。"
			});
			return;
		}
		if (current.submissions[configRef.current.humanId]) {
			showResult(configRef.current.humanId, true);
			return;
		}
		const key = `submit:${current.session_id}:${answerText}`;
		const requestId = requestIdFor(key);
		setBusy((value) => ({
			...value,
			submit: true
		}));
		try {
			let next = current;
			let submission;
			if (realSessionRef.current) {
				const data = await request("/submit", "POST", {
					session_id: current.session_id,
					player: configRef.current.humanId,
					source: "standalone-web",
					request_id: requestId,
					answer: answerText
				});
				if (!gameRef.current || String(gameRef.current.session_id) !== String(current.session_id)) {
					toast("房间已切换，旧房间的评分不会写入新局");
					return;
				}
				next = normalizeState(data, current, selectedMode, {
					humanId: configRef.current.humanId,
					aiId: configRef.current.aiId
				});
				submission = next.submissions[configRef.current.humanId] || normalizeSubmission({
					score: data.score ?? data.overall,
					rank: data.rank,
					score_detail: data.score_detail ?? data.detail,
					comment: data.comment,
					submitted_answer: answerText,
					request_id: requestId
				}, configRef.current.humanId);
			} else {
				const hits = [
					"信号",
					"送货",
					"预留",
					"取走",
					"约定"
				].filter((word) => answerText.includes(word)).length;
				const keyPlot = Math.min(100, 35 + hits * 13);
				const logic = Math.min(96, answerText.length > 42 ? 86 : answerText.length > 24 ? 74 : 58);
				const detail = Math.min(96, 38 + [
					"面包",
					"灯",
					"店主",
					"取走"
				].filter((word) => answerText.includes(word)).length * 14);
				const total = Math.round(keyPlot * .4 + logic * .3 + detail * .3);
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
					submitted_at: now()
				};
			}
			next = {
				...next,
				submissions: {
					...next.submissions,
					[configRef.current.humanId]: {
						...submission,
						answer: submission.answer || answerText
					}
				}
			};
			if (next.mode !== "easy") next = {
				...next,
				questions_left: {
					...next.questions_left,
					[configRef.current.humanId]: 0
				}
			};
			if (submission.total >= 90) next = {
				...next,
				status: "won"
			};
			else if (next.mode !== "easy" && Number(next.questions_left[configRef.current.aiId] || 0) <= 0) next = {
				...next,
				status: "lost"
			};
			next = appendLogIfMissing(next, {
				type: "submit",
				player: configRef.current.humanId,
				source: "standalone-web",
				request_id: requestId,
				text: `已提交完整推理 · ${submission.total} 分 ${submission.rank}`,
				submitted_answer: answerText,
				time: now()
			});
			commitGame(next);
			clearRequestId(key);
			setTheoryDraft("");
			showResult(configRef.current.humanId, true);
		} catch (error) {
			const apiError = error;
			if (apiError.status === 409 || apiError.data?.error === "already_submitted") {
				await syncCurrent();
				if (gameRef.current?.submissions[configRef.current.humanId]) {
					clearRequestId(key);
					showResult(configRef.current.humanId, true);
					return;
				}
			}
			openDialog({
				kind: "submit",
				error: apiError.message
			});
		} finally {
			setBusy((value) => ({
				...value,
				submit: false
			}));
		}
	};
	const revealBottom = async () => {
		const current = gameRef.current;
		if (!current || busy.reveal) return;
		const key = `reveal:${current.session_id}`;
		setBusy((value) => ({
			...value,
			reveal: true
		}));
		holdSettlement(current.session_id);
		try {
			let next = current;
			if (realSessionRef.current) {
				const data = await request("/reveal", "POST", {
					session_id: current.session_id,
					room_key: configRef.current.roomKey,
					player: configRef.current.humanId,
					source: "standalone-web",
					request_id: requestIdFor(key)
				});
				if (!gameRef.current || String(gameRef.current.session_id) !== String(current.session_id)) {
					toast("房间已切换，旧房间的汤底不会写入新局");
					return;
				}
				next = normalizeState(data, current, selectedMode, {
					humanId: configRef.current.humanId,
					aiId: configRef.current.aiId
				});
			}
			next = {
				...next,
				soup_bottom_revealed: true,
				status: next.status === "won" ? "won" : "lost"
			};
			clearRequestId(key);
			commitGame(next);
			showResult(dialogRef.current.player, true);
		} catch (error) {
			toast(error.message);
		} finally {
			setBusy((value) => ({
				...value,
				reveal: false
			}));
		}
	};
	const abandonRound = async () => {
		const current = gameRef.current;
		if (!current || busy.abandon) return;
		setBusy((value) => ({
			...value,
			abandon: true
		}));
		try {
			if (realSessionRef.current) await request("/abandon", "POST", {
				session_id: current.session_id,
				room_key: configRef.current.roomKey,
				player: configRef.current.humanId,
				source: "standalone-web",
				request_id: createRequestId()
			});
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
			openDialog({
				kind: "abandon",
				error: error.message
			});
		} finally {
			setBusy((value) => ({
				...value,
				abandon: false
			}));
		}
	};
	const proceedToNext = async () => {
		const current = gameRef.current;
		const ready = pendingNextRef.current;
		if (ready) {
			const previousId = current?.session_id;
			if (await joinSession(ready.session_id, {
				silent: true,
				activate: false
			})) {
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
		const next = {
			...config,
			apiBase: config.apiBase.trim() || "/api/game",
			roomKey: config.roomKey.trim() || "haiguitang-main",
			pollMs: Math.max(1200, Number(config.pollMs) || 3e3),
			humanId: config.humanId.trim() || "xinxin",
			aiId: config.aiId.trim() || "azhi",
			humanName: config.humanName.trim() || "玩家",
			aiName: config.aiName.trim() || "AI 搭档"
		};
		configRef.current = next;
		setConfig(next);
		window.localStorage.setItem(STORAGE.config, JSON.stringify(next));
		closeDialog();
		toast("连接设置已保存在当前浏览器");
	};
	(0, import_react.useEffect)(() => {
		configRef.current = config;
		window.localStorage.setItem(STORAGE.config, JSON.stringify(config));
	}, [config]);
	(0, import_react.useEffect)(() => {
		dialogRef.current = dialog;
	}, [dialog]);
	(0, import_react.useEffect)(() => {
		pendingNextRef.current = pendingNext;
	}, [pendingNext]);
	(0, import_react.useEffect)(() => {
		if (bootedRef.current) return;
		bootedRef.current = true;
		let cancelled = false;
		const boot = async () => {
			const cachedRaw = loadJson(STORAGE.state, null);
			let cached = null;
			if (cachedRaw?.session_id != null) cached = normalizeState(cachedRaw, void 0, selectedMode, {
				humanId: configRef.current.humanId,
				aiId: configRef.current.aiId
			});
			if (cached && leftSessions().includes(String(cached.session_id))) cached = null;
			if (cached && isRoundClosed(cached)) {
				commitGame(cached, !String(cached.session_id).startsWith("demo-"));
				changeView("game");
				holdSettlement(cached.session_id);
				showResult(void 0, true);
				if (!String(cached.session_id).startsWith("demo-")) try {
					const data = await request(`/status?session_id=${encodeURIComponent(cached.session_id)}`);
					if (!cancelled) {
						commitGame(normalizeState(data, cached, selectedMode, {
							humanId: configRef.current.humanId,
							aiId: configRef.current.aiId
						}), true);
						showResult(void 0, true);
					}
				} catch {}
				if (configRef.current.autoJoin) await discoverActive(true, false);
				return;
			}
			if (configRef.current.autoJoin && await discoverActive(true, false)) return;
			if (cached) {
				commitGame(cached, !String(cached.session_id).startsWith("demo-"));
				changeView("game");
				if (!String(cached.session_id).startsWith("demo-")) await joinSession(cached.session_id, {
					silent: true,
					activate: false
				});
				return;
			}
			changeView("welcome");
		};
		boot();
		return () => {
			cancelled = true;
		};
	}, []);
	(0, import_react.useEffect)(() => {
		if (!realSession || view !== "game" || !game?.session_id) return;
		const timer = window.setInterval(() => void syncCurrent(), Math.max(1200, config.pollMs));
		return () => window.clearInterval(timer);
	}, [
		realSession,
		view,
		game?.session_id,
		config.pollMs
	]);
	(0, import_react.useEffect)(() => {
		if (view !== "lobby" || !config.autoJoin) return;
		const timer = window.setInterval(() => void discoverActive(true, false), Math.max(1200, config.pollMs));
		return () => window.clearInterval(timer);
	}, [
		view,
		config.autoJoin,
		config.pollMs
	]);
	(0, import_react.useEffect)(() => {
		const element = logRef.current;
		if (!element) return;
		if (element.scrollHeight - element.scrollTop - element.clientHeight < 150) element.scrollTop = element.scrollHeight;
	}, [game?.questions_log.length]);
	(0, import_react.useEffect)(() => {
		const onKeyDown = (event) => {
			if (event.key === "Escape" && dialogRef.current.kind) closeDialog();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});
	const humanLeft = game?.questions_left[config.humanId] ?? null;
	const aiLeft = game?.questions_left[config.aiId] ?? null;
	const hintsLeft = game?.hints_total == null ? null : Math.max(0, game.hints_total - game.hints_used);
	const humanSubmission = game?.submissions[config.humanId];
	const partnerSubmission = game?.submissions[config.aiId];
	const closed = isRoundClosed(game);
	const canAsk = Boolean(game && !closed && !humanSubmission && !busy.ask && (humanLeft == null || humanLeft > 0));
	const canHint = Boolean(game && !closed && game.mode !== "hard" && game.hints_total !== 0 && (hintsLeft == null || hintsLeft > 0));
	const resultSubmission = (0, import_react.useMemo)(() => {
		if (!game) return null;
		return (dialog.player ? game.submissions[dialog.player] : null) || bestSubmission(game);
	}, [game, dialog.player]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "app-shell",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "sky-glow sky-glow--one" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "sky-glow sky-glow--two" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "stars",
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "site-header",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					className: "brand",
					onClick: () => game ? changeView("game") : changeView("welcome"),
					"aria-label": "回到海龟汤首页",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "brand-mark",
						"aria-hidden": "true",
						children: "龟"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "海龟汤" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "人机共游版" })] })]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
					className: "header-actions",
					"aria-label": "快捷操作",
					children: [view === "game" && game && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "quiet-button",
						onClick: () => openDialog({ kind: "rules" }),
						children: "规则"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "icon-button",
						onClick: () => openDialog({ kind: "settings" }),
						"aria-label": "连接设置",
						title: "连接设置",
						children: "⚙"
					})]
				})]
			}),
			view === "welcome" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "welcome-screen page-enter",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "welcome-copy",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "eyebrow",
							children: "CO-OP LATERAL THINKING"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", { children: [
							"一碗谜题，",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
							"两个人的推理现场。"
						] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "welcome-lead",
							children: "人类在网页操作，AI 通过 MCP 参与。双方共享同一个房间、同一份日志和同一场结算。"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "welcome-actions",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: "primary-button",
								onClick: () => {
									window.localStorage.setItem(STORAGE.rules, "1");
									changeView("lobby");
								},
								children: ["进入游戏机 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "→" })]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: "text-button",
								onClick: () => openDialog({ kind: "rules" }),
								children: "先读玩法"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "feature-line",
							"aria-label": "产品特性",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "共享房间" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "断点恢复" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "三维评分" })
							]
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "welcome-visual",
					"aria-label": "海龟汤游戏预览",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "orbit orbit--outer" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "orbit orbit--inner" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "soup-bowl",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "soup-surface",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "steam steam--one",
										children: "∿"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "steam steam--two",
										children: "∿"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "?" })
								]
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "floating-card floating-card--left",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "主持人" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "是也不是" })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "floating-card floating-card--right",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "共同记录" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "12 条线索" })]
						})
					]
				})]
			}),
			view === "lobby" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "lobby-screen page-enter",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "section-heading",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "eyebrow",
								children: "CHOOSE YOUR PACE"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "今晚，想怎么推理？" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "先选择通关节奏。网页和 AI 任一方开局，另一方都会从共享房间同步。" })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mode-grid",
						children: [
							{
								mode: "easy",
								number: "∞",
								name: "轻松",
								copy: "不限提问与提示，适合慢慢拆解。",
								meta: "无限提问 · 无限提示"
							},
							{
								mode: "normal",
								number: "06",
								name: "正常",
								copy: "每人六问，三层提示，节奏刚好。",
								meta: "每人 6 问 · 3 次提示"
							},
							{
								mode: "hard",
								number: "03",
								name: "困难",
								copy: "三轮定方向，没有提示可依赖。",
								meta: "每人 3 问 · 无提示"
							}
						].map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							className: `mode-card ${selectedMode === item.mode ? "mode-card--selected" : ""}`,
							onClick: () => {
								setSelectedMode(item.mode);
								window.localStorage.setItem(STORAGE.mode, item.mode);
							},
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "mode-number",
									children: item.number
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "mode-check",
									children: selectedMode === item.mode ? "✓" : ""
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: item.name }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: item.copy }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: item.meta })
							]
						}, item.mode))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "lobby-controls glass-panel",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "room-status",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "status-dot" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "共享房间" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: roomMessage })] })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: "primary-button primary-button--wide",
								disabled: busy.start,
								onClick: () => void startGame(false),
								children: [busy.start ? "主持人正在抽题…" : "抽取一碗汤", !busy.start && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "→" })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "join-divider",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "或加入已有游戏" })
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
								className: "join-form",
								onSubmit: (event) => {
									event.preventDefault();
									joinSession(joinId);
								},
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
										htmlFor: "session-input",
										children: "Session ID"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										id: "session-input",
										value: joinId,
										onChange: (event) => setJoinId(event.target.value),
										inputMode: "numeric",
										placeholder: "例如：21",
										autoComplete: "off"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										disabled: busy.join,
										children: busy.join ? "加入中…" : "加入"
									})
								]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "lobby-footnote",
						children: "API 密钥、汤底与评分关键点只应保存在后端；独立前端不会接触这些秘密。"
					})
				]
			}),
			view === "game" && game && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "game-screen page-enter",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "game-topline",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: "back-button",
								onClick: () => isRoundClosed(game) ? returnToLobby() : openDialog({ kind: "abandon" }),
								"aria-label": isRoundClosed(game) ? "返回难度选择" : "离开本局",
								children: "←"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "session-chip",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: realSession ? "live-dot" : "demo-dot" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["SESSION ", game.session_id] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										onClick: async () => {
											try {
												await navigator.clipboard.writeText(String(game.session_id));
												toast("Session ID 已复制");
											} catch {
												toast(`Session ID：${game.session_id}`);
											}
										},
										"aria-label": "复制 Session ID",
										title: "复制 Session ID",
										children: "⧉"
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "sync-label",
								children: pendingNext ? `下一题 ${pendingNext.session_id} 待进入` : settlementLocked ? "结算已锁定" : realSession ? "自动同步中" : "演示模式"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: "soup-card",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "soup-card-head",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "eyebrow",
									children: "TONIGHT'S SOUP"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", { children: [
									"《",
									game.title,
									"》"
								] })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "badge-row",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: game.difficulty || "中等" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: modeNames[game.mode] || game.mode })]
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "soup-face",
								children: game.soup_face
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "soup-card-foot",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "主持人只回答：是 / 否 / 是也不是 / 无关" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									onClick: () => openDialog({ kind: "rules" }),
									children: "查看规则"
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "resource-grid",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "resource-card",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "player-seal",
										children: "人"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [config.humanName, "剩余"] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: humanLeft == null ? "∞" : humanLeft })] }),
									humanSubmission && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: "已提交" })
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "resource-card",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "player-seal player-seal--ai",
										children: "AI"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [config.aiName, "剩余"] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: aiLeft == null ? "∞" : aiLeft })] }),
									partnerSubmission && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: "已提交" })
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "resource-card resource-card--hint",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "player-seal player-seal--hint",
										children: "✦"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "阶梯提示" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [hintsLeft == null ? "∞" : hintsLeft, game.hints_total != null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("i", { children: [" / ", game.hints_total] })] })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("em", { children: ["已取 ", game.hints_used] })
								]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "action-grid",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: "action-card action-card--ask",
								disabled: !canAsk,
								onClick: () => {
									setQuestionDraft("");
									openDialog({ kind: "ask" });
								},
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "?" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "提问" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: humanSubmission ? "本方已提交" : "问一个是否问题" })
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: "action-card action-card--hint",
								disabled: !canHint,
								onClick: () => openDialog({ kind: "hint-confirm" }),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "✦" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "提示" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: game.mode === "hard" ? "困难模式禁用" : "按阶梯取一条" })
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: "action-card action-card--submit",
								disabled: !humanSubmission && closed,
								onClick: () => {
									if (humanSubmission) showResult(config.humanId, true);
									else {
										setTheoryDraft("");
										openDialog({ kind: "submit" });
									}
								},
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: humanSubmission ? "✓" : "↗" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: humanSubmission ? "已提交" : "提交" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: humanSubmission ? "查看评分和原文" : "完整推理与评分" })
								]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "log-panel glass-panel",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "log-head",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "eyebrow",
								children: "SHARED TIMELINE"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "共同推理记录" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [game.questions_log.length, " 条"] })]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "log-list",
							ref: logRef,
							children: game.questions_log.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "empty-log",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "◎" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "第一条问题会出现在这里，网页和 AI 都能看到。" })]
							}) : game.questions_log.map((item, index) => {
								const isQuestion = item.type === "question" || Boolean(item.question);
								const isHint = item.type === "hint" || Boolean(item.hint);
								const isSubmit = item.type === "submit" || Boolean(item.submitted_answer);
								const label = isQuestion ? playerName(item.player) : isHint ? "主持人提示" : isSubmit ? playerName(item.player || item.submitted_by) : "主持人";
								const content = String(item.question || item.hint || item.text || item.answer || "");
								return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
									className: `log-entry ${isHint ? "log-entry--hint" : ""} ${isSubmit ? "log-entry--submit" : ""}`,
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "log-avatar",
										children: isHint ? "✦" : isSubmit ? "✓" : label.slice(0, 1)
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "log-content",
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: label }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { children: String(item.time || "") })] }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: content }),
											item.answer && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
												className: `answer-pill ${answerClass(String(item.answer))}`,
												children: String(item.answer)
											})
										]
									})]
								}, String(item.request_id || `${index}-${content}`));
							})
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "round-footer",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: "footer-link footer-link--danger",
								disabled: closed,
								onClick: () => openDialog({ kind: "abandon" }),
								children: "放弃本局"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: roomMessage }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: "footer-link",
								onClick: () => showResult(void 0, true),
								children: closed ? "查看结算" : "结束本局"
							})
						]
					})
				]
			}),
			dialog.kind && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "dialog-backdrop",
				role: "presentation",
				onMouseDown: (event) => {
					if (event.target === event.currentTarget) closeDialog();
				},
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: `dialog-card dialog-card--${dialog.kind}`,
					role: "dialog",
					"aria-modal": "true",
					"aria-labelledby": "dialog-title",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "dialog-close",
							onClick: closeDialog,
							"aria-label": "关闭",
							children: "×"
						}),
						dialog.kind === "rules" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "eyebrow",
								children: "RULES AT A GLANCE"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								id: "dialog-title",
								children: "先把规则装进口袋"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "dialog-lead",
								children: "主持人掌握汤底。玩家通过是否问题，逐步还原完整故事。"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rule-list",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "01" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "只问是否问题" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "驳回不扣次数，并给出改写说明。" })] })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "02" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "提示逐层解锁" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "大方向 → 收窄范围 → 接近答案。" })] })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "03" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "每人一次正式提交" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "正常/困难模式提交后，本方剩余提问归零。" })] })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "04" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "结算不会自动跳题" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "评分、推理原文与汤底会停留，直到手动进入下一题。" })] })] })
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "score-formula",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "关键情节 40%" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "逻辑连贯 30%" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "细节还原 30%" })
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: "primary-button primary-button--wide",
								onClick: closeDialog,
								children: ["明白了，继续 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "→" })]
							})
						] }),
						dialog.kind === "settings" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "eyebrow",
								children: "CONNECTION SETTINGS"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								id: "dialog-title",
								children: "连接你的主持人"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "dialog-lead",
								children: "设置只保存在本浏览器。密钥、汤底与评分关键点不要写进前端。"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "settings-grid",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "field field--full",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "API 根地址" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											value: config.apiBase,
											onChange: (event) => setConfig((value) => ({
												...value,
												apiBase: event.target.value
											})),
											placeholder: "/api/game"
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "field field--full",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "共享房间 key" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											value: config.roomKey,
											onChange: (event) => setConfig((value) => ({
												...value,
												roomKey: event.target.value
											})),
											placeholder: "haiguitang-main"
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "field",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "人类玩家 ID" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											value: config.humanId,
											onChange: (event) => setConfig((value) => ({
												...value,
												humanId: event.target.value
											}))
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "field",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "AI 玩家 ID" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											value: config.aiId,
											onChange: (event) => setConfig((value) => ({
												...value,
												aiId: event.target.value
											}))
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "field",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "人类显示名" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											value: config.humanName,
											onChange: (event) => setConfig((value) => ({
												...value,
												humanName: event.target.value
											}))
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "field",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "AI 显示名" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											value: config.aiName,
											onChange: (event) => setConfig((value) => ({
												...value,
												aiName: event.target.value
											}))
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "field",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "轮询间隔（毫秒）" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											type: "number",
											min: "1200",
											step: "100",
											value: config.pollMs,
											onChange: (event) => setConfig((value) => ({
												...value,
												pollMs: Number(event.target.value)
											}))
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "toggle-stack",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: config.autoJoin,
											onChange: (event) => setConfig((value) => ({
												...value,
												autoJoin: event.target.checked
											}))
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "自动寻找共享房间" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: config.fallbackDemo,
											onChange: (event) => setConfig((value) => ({
												...value,
												fallbackDemo: event.target.checked
											}))
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "离线时进入演示模式" })] })]
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: "primary-button primary-button--wide",
								onClick: saveSettings,
								children: ["保存连接设置 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "→" })]
							})
						] }),
						dialog.kind === "ask" && game && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "eyebrow",
								children: "ASK THE HOST"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								id: "dialog-title",
								children: "问主持人一个问题"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "dialog-lead",
								children: [
									config.humanName,
									"剩余 ",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: humanLeft == null ? "∞" : humanLeft }),
									" 次。被驳回的问题不会扣次数。"
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "field field--textarea",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "是否问题" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
									autoFocus: true,
									maxLength: 180,
									value: questionDraft,
									onChange: (event) => setQuestionDraft(event.target.value),
									placeholder: "例如：这个人之前认识店主吗？"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: `form-note ${dialog.error ? "form-note--error" : ""}`,
								children: dialog.error || "问题应当能用“是 / 否 / 是也不是 / 无关”回答。"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: "primary-button primary-button--wide",
								disabled: busy.ask || !questionDraft.trim(),
								onClick: () => void submitQuestion(),
								children: [busy.ask ? "主持人判断中…" : dialog.error ? "修改后重新提交" : "递给主持人", !busy.ask && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "→" })]
							})
						] }),
						dialog.kind === "hint-confirm" && game && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "center-dialog",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "hint-orb",
									children: "✦"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "eyebrow",
									children: "HINT LADDER"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", {
									id: "dialog-title",
									children: [
										"取第 ",
										game.hints_used + 1,
										" 级提示？"
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "dialog-lead",
									children: "提示会从大方向逐步接近答案；上一层取出后，下一层才会解锁。"
								}),
								dialog.error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "form-note form-note--error",
									children: dialog.error
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									className: "primary-button primary-button--wide",
									disabled: busy.hint,
									onClick: () => void takeHint(),
									children: [busy.hint ? "正在拆开线索…" : "取出这条提示", !busy.hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "→" })]
								})
							]
						}),
						dialog.kind === "hint-result" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "center-dialog",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "hint-orb hint-orb--open",
									children: "✦"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "eyebrow",
									children: ["HINT ", dialog.hintIndex || ""]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
									id: "dialog-title",
									children: dialog.remote ? "搭档取出了一条提示" : "主持人递来一条线索"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "hint-paper",
									children: dialog.hint
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									className: "primary-button primary-button--wide",
									onClick: closeDialog,
									children: ["记下这条提示 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "→" })]
								})
							]
						}),
						dialog.kind === "submit" && game && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "eyebrow",
								children: ["FINAL THEORY · ", config.humanName]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								id: "dialog-title",
								children: "把故事完整地拼起来"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "submit-warning",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "提交后：" }), game.mode === "easy" ? "本局每位玩家只有一次正式提交机会。" : `${config.humanName}的剩余提问将归零；未满 90 分时，搭档仍可继续。`]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "field field--textarea field--theory",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "完整推理" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
									autoFocus: true,
									maxLength: 1200,
									value: theoryDraft,
									onChange: (event) => setTheoryDraft(event.target.value),
									placeholder: "请写出人物关系、事件经过、原因与关键细节……"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: `form-note ${dialog.error ? "form-note--error" : ""}`,
								children: dialog.error || "建议至少包含：动机、因果和关键转折。"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: "primary-button primary-button--wide",
								disabled: busy.submit,
								onClick: () => void submitTheory(),
								children: [busy.submit ? "主持人评分中…" : dialog.error ? "重新提交并评分" : "确认提交并评分", !busy.submit && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "→" })]
							})
						] }),
						dialog.kind === "result" && game && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "result-dialog",
							children: [
								resultSubmission ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "score-orb",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: resultSubmission.total }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "综合评分" })]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "eyebrow",
										children: "HOST'S VERDICT"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
										id: "dialog-title",
										children: resultSubmission.rank
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
										className: "dialog-lead",
										children: [
											playerName(resultSubmission.player),
											"本次提交获得 ",
											resultSubmission.total,
											" 分。"
										]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScoreRow, {
										label: "关键情节",
										weight: "40%",
										value: resultSubmission.key_plot
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScoreRow, {
										label: "逻辑连贯",
										weight: "30%",
										value: resultSubmission.logic
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScoreRow, {
										label: "细节还原",
										weight: "30%",
										value: resultSubmission.detail
									}),
									resultSubmission.comment && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
										className: "host-comment",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "主持人评语：" }), resultSubmission.comment]
									}),
									resultSubmission.answer && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
										className: "theory-record",
										open: true,
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "提交的推理原文" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: resultSubmission.answer })]
									})
								] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "score-orb score-orb--empty",
										children: "—"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "eyebrow",
										children: "END THIS ROUND"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
										id: "dialog-title",
										children: "本局还没有正式提交"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "dialog-lead",
										children: "没有提交内容，因此暂时没有评分。你可以返回继续推理，或查看汤底结束本局。"
									})
								] }),
								game.soup_bottom_revealed ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "bottom-paper",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "原汤底" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: game.soup_bottom || "后端尚未返回原汤底。" })]
								}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "reveal-button",
									disabled: busy.reveal,
									onClick: () => void revealBottom(),
									children: busy.reveal ? "正在揭开汤底…" : "查看原汤底（会结束本局）"
								}),
								pendingNext && String(pendingNext.session_id) !== String(game.session_id) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "next-ready-note",
									children: [
										config.aiName,
										"或另一端已准备好 Session ",
										pendingNext.session_id,
										"。当前结算会保留，点击后才进入。"
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "result-actions",
									children: !closed ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										className: "secondary-button",
										onClick: closeDialog,
										children: "继续本局"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										className: "primary-button",
										onClick: () => void revealBottom(),
										children: ["结束并揭底 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "→" })]
									})] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										className: "secondary-button",
										onClick: closeDialog,
										children: "留在本局复盘"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										className: "primary-button",
										disabled: busy.start || busy.join,
										onClick: () => void proceedToNext(),
										children: [pendingNext ? `进入下一题 · ${pendingNext.session_id}` : busy.start ? "主持人正在抽题…" : "抽取下一题", !busy.start && !busy.join && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "→" })]
									})] })
								}),
								closed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "text-button result-mode-link",
									onClick: returnToLobby,
									children: "返回难度选择"
								})
							]
						}),
						dialog.kind === "abandon" && game && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "eyebrow",
								children: "LEAVE WITHOUT SETTLEMENT"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								id: "dialog-title",
								children: "确定放弃本局？"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "submit-warning",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "放弃不会结算：" }),
									"不显示评分、不公开汤底，并直接离开 Session ",
									game.session_id,
									"。"
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: `form-note ${dialog.error ? "form-note--error" : ""}`,
								children: dialog.error || "如果只是想看评分或汤底，请关闭这里并点“结束本局”。"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "result-actions",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "secondary-button",
									onClick: closeDialog,
									children: "继续推理"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "danger-button",
									disabled: busy.abandon,
									onClick: () => void abandonRound(),
									children: busy.abandon ? "正在退出…" : "确认放弃"
								})]
							})
						] })
					]
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: `toast ${toastMessage ? "toast--visible" : ""}`,
				"aria-live": "polite",
				children: toastMessage
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", {
				className: "site-footer",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "HAIGUITANG · OPEN CO-OP FRONTEND" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "界面状态以共享后端 Session 为准" })]
			})
		]
	});
}
function ScoreRow({ label, weight, value }) {
	const safeValue = clampScore(value);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "score-row",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
			label,
			" ",
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: weight })
		] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: Math.round(safeValue) })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { style: { width: `${safeValue}%` } }) })]
	});
}
//#endregion
export { Home as default };
