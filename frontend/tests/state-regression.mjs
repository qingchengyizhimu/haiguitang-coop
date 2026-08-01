import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const gameModule = process.env.HAIGUITANG_GAME_MODULE;
if (!gameModule) throw new Error("HAIGUITANG_GAME_MODULE is required");

const imported = await import(pathToFileURL(gameModule).href);
const { normalizeState } = imported.default ?? imported;
const players = { humanId: "xinxin", aiId: "azhi" };

const staleHintCounter = normalizeState(
  {
    session_id: 17,
    status: "playing",
    mode: "normal",
    hints_used: 3,
    hints_total: 4,
    revealed_hints: [],
    submissions: {},
    questions_log: [],
  },
  undefined,
  "normal",
  players,
);
assert.equal(
  staleHintCounter.hints_used,
  0,
  "revealed_hints must be the authoritative hint ledger",
);

const easy = normalizeState(
  {
    session_id: 20,
    status: "playing",
    mode: "easy",
    hints_total: null,
    revealed_hints: [],
    questions_left: { xinxin: null, azhi: null },
    questions_log: [],
    submissions: {},
  },
  undefined,
  "easy",
  players,
);
const easyPoll = normalizeState(
  { session_id: 20, status: "playing", questions_log: [] },
  easy,
  "easy",
  players,
);
assert.equal(easyPoll.hints_total, null, "easy mode must remain unlimited");

const closed = normalizeState(
  {
    session_id: 21,
    status: "won",
    mode: "normal",
    soup_bottom_revealed: true,
    questions_left: { xinxin: 0, azhi: 0 },
    revealed_hints: [{ index: 1, hint: "第一条" }],
    submissions: {
      xinxin: {
        submitted_answer: "完整推理",
        score: 94,
        score_detail: { key_plot: 100, logic: 90, detail: 90 },
      },
    },
    questions_log: [
      {
        request_id: "q-1",
        player: "xinxin",
        question: "这是一个是否问题吗？",
        answer: "是",
      },
    ],
  },
  undefined,
  "normal",
  players,
);

const stalePoll = normalizeState(
  {
    session_id: 21,
    status: "playing",
    soup_bottom_revealed: false,
    questions_left: { xinxin: 6, azhi: 6 },
    revealed_hints: [{ index: 1, hint: "第一条" }],
    submissions: closed.submissions,
    questions_log: [
      {
        request_id: "q-1",
        player: "xinxin",
        question: "这是一个是否问题吗？",
        answer: "是",
      },
    ],
  },
  closed,
  "normal",
  players,
);

assert.equal(stalePoll.status, "won", "closed status must not regress");
assert.equal(stalePoll.soup_bottom_revealed, true, "reveal must not regress");
assert.equal(stalePoll.questions_left.xinxin, 0, "counter must not increase");
assert.equal(
  stalePoll.questions_log.filter((item) => item.request_id === "q-1").length,
  1,
  "request_id must deduplicate the log",
);
assert.equal(
  stalePoll.questions_log.filter((item) => item.type === "hint").length,
  1,
  "stored hints must appear once in the shared timeline",
);
assert.equal(
  stalePoll.questions_log.filter((item) => item.type === "submit").length,
  1,
  "stored submissions must appear once in the shared timeline",
);
assert.equal(stalePoll.submissions.xinxin.answer, "完整推理");
assert.equal(stalePoll.submissions.xinxin.total, 94);

console.log("state regression tests: 10 assertions passed");
