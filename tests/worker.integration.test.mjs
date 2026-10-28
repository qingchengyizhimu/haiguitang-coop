import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

class MockD1Statement {
  constructor(database, query, values = []) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values) {
    return new MockD1Statement(this.database, this.query, values);
  }

  async first() {
    return this.database.sqlite.prepare(this.query).get(...this.values) ?? null;
  }

  async all() {
    return {
      success: true,
      results: this.database.sqlite.prepare(this.query).all(...this.values),
      meta: { changes: 0 },
    };
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    const result = this.database.sqlite.prepare(this.query).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
}

class MockD1Database {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(readFileSync(new URL("../drizzle/0000_sites_sessions.sql", import.meta.url), "utf8"));
  }

  prepare(query) {
    return new MockD1Statement(this, query);
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("integration", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);
const DB = new MockD1Database();
const env = { DB };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ownerHeader = (owner) => ({
  "content-type": "application/json",
  "oai-authenticated-user-id": owner,
});

async function rest(path, { owner, method = "GET", body } = {}) {
  const response = await worker.fetch(
    new Request(`http://sites.test/api/game${path}`, {
      method,
      headers: owner ? ownerHeader(owner) : { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    ctx,
  );
  return { response, data: await response.json() };
}

async function mcp(owner, method, params, id = 1) {
  const response = await worker.fetch(
    new Request("http://sites.test/mcp", {
      method: "POST",
      headers: owner ? ownerHeader(owner) : { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
    env,
    ctx,
  );
  return { response, data: await response.json() };
}

const toolPayload = (rpc) => JSON.parse(rpc.result.content[0].text);

test("formal migration applies and creates the constrained session schema", () => {
  const hosting = JSON.parse(
    readFileSync(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  );
  assert.equal(hosting.d1.binding, "DB");
  assert.equal(hosting.r2, null);
  assert.ok(hosting.capabilities.includes("mcp"));
  const table = DB.sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'game_sessions'")
    .get();
  assert.match(table.sql, /owner_id TEXT NOT NULL/);
  assert.match(table.sql, /state_json TEXT NOT NULL/);
  assert.match(table.sql, /json_valid\(state_json\)/);
  const indexes = DB.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'game_sessions'")
    .all()
    .map((row) => row.name);
  assert.ok(indexes.includes("game_sessions_owner_active_room"));
  assert.ok(indexes.includes("game_sessions_owner_start_request"));
});

test("private REST and MCP routes reject missing Sites identity", async () => {
  const page = await worker.fetch(new Request("http://sites.test/"), env, ctx);
  assert.equal(page.status, 401);
  const restResult = await rest("/health");
  assert.equal(restResult.response.status, 401);
  const mcpResult = await mcp(null, "server/discover");
  assert.equal(mcpResult.response.status, 401);
  assert.equal(mcpResult.data.error.code, -32001);
});

test("REST and MCP share an isolated, idempotent D1 session", async () => {
  const owner = "owner-alpha";
  const other = "owner-beta";
  const startBody = {
    mode: "normal",
    room_key: "shared-room",
    reuse_active: true,
    request_id: "start-1",
  };
  const started = await rest("/start", { owner, method: "POST", body: startBody });
  assert.equal(started.response.status, 200);
  assert.equal(started.data.mock, true);
  assert.equal("soup_bottom" in started.data, false);
  const sessionId = started.data.session_id;

  const repeatedStart = await rest("/start", { owner, method: "POST", body: startBody });
  assert.equal(repeatedStart.data.session_id, sessionId);
  assert.equal(repeatedStart.data.duplicate, true);

  const isolated = await rest(`/status?session_id=${sessionId}`, { owner: other });
  assert.equal(isolated.response.status, 404);
  const otherCurrent = await mcp(other, "tools/call", {
    name: "haiguitang_current",
    arguments: { room_key: "shared-room", owner_id: owner },
  });
  assert.equal(toolPayload(otherCurrent.data).active, false);

  const firstAsk = await rest("/ask", {
    owner,
    method: "POST",
    body: {
      session_id: sessionId,
      player: "xinxin",
      question: "这和外星人有关吗？",
      request_id: "ask-1",
    },
  });
  assert.equal(firstAsk.data.answer, "无关");
  assert.equal(firstAsk.data.questions_left.xinxin, 5);
  const duplicateAsk = await rest("/ask", {
    owner,
    method: "POST",
    body: {
      session_id: sessionId,
      player: "xinxin",
      question: "内容即使改变也不能重复扣次数",
      request_id: "ask-1",
    },
  });
  assert.equal(duplicateAsk.data.duplicate, true);
  assert.equal(duplicateAsk.data.questions_left.xinxin, 5);

  const partial = await rest("/ask", {
    owner,
    method: "POST",
    body: {
      session_id: sessionId,
      player: "xinxin",
      question: "只有一部分相关吗？",
      request_id: "ask-2",
    },
  });
  assert.equal(partial.data.answer, "部分相关");
  const rejected = await rest("/ask", {
    owner,
    method: "POST",
    body: {
      session_id: sessionId,
      player: "xinxin",
      question: "无法判断吗？",
      request_id: "ask-3",
    },
  });
  assert.equal(rejected.data.answer, "驳回");

  const current = await mcp(owner, "tools/call", {
    name: "haiguitang_current",
    arguments: { room_key: "shared-room" },
  });
  const currentPayload = toolPayload(current.data);
  assert.equal(currentPayload.session_id, sessionId);
  assert.equal(currentPayload.questions_log.length, 2);
  assert.equal("soup_bottom" in currentPayload, false);

  const mcpAsk = await mcp(owner, "tools/call", {
    name: "haiguitang_ask",
    arguments: { session_id: sessionId, question: "这是网页也会看到的吗？" },
  });
  const mcpAskPayload = toolPayload(mcpAsk.data);
  assert.equal(mcpAskPayload.must_stop_this_turn, true);
  const afterMcp = await rest(`/status?session_id=${sessionId}`, { owner });
  assert.equal(afterMcp.data.questions_log.length, 3);
  assert.equal(afterMcp.data.questions_log.at(-1).player, "azhi");
});

test("concurrent room starts converge and concurrent mutations are not lost", async () => {
  const owner = "owner-concurrent";
  const starts = await Promise.all(
    ["concurrent-start-a", "concurrent-start-b"].map((request_id) =>
      rest("/start", {
        owner,
        method: "POST",
        body: {
          mode: "normal",
          room_key: "concurrent-room",
          reuse_active: true,
          request_id,
        },
      }),
    ),
  );
  assert.equal(starts[0].response.status, 200);
  assert.equal(starts[1].response.status, 200);
  assert.equal(starts[0].data.session_id, starts[1].data.session_id);
  const id = starts[0].data.session_id;

  await Promise.all(
    ["parallel-ask-a", "parallel-ask-b"].map((request_id, index) =>
      rest("/ask", {
        owner,
        method: "POST",
        body: {
          session_id: id,
          player: "xinxin",
          question: `并发问题 ${index + 1} 是吗？`,
          request_id,
        },
      }),
    ),
  );
  const state = await rest(`/status?session_id=${id}`, { owner });
  assert.equal(state.data.questions_left.xinxin, 4);
  assert.equal(state.data.questions_log.length, 2);
});

test("MCP discover, list, consent brakes, mock score and reveal persistence", async () => {
  const owner = "owner-alpha";
  const current = await mcp(owner, "tools/call", {
    name: "haiguitang_current",
    arguments: { room_key: "shared-room" },
  });
  const sessionId = toolPayload(current.data).session_id;

  const discover = await mcp(owner, "server/discover");
  assert.deepEqual(discover.data.result.supportedVersions, ["2026-07-28"]);
  assert.deepEqual(discover.data.result.capabilities, { tools: {} });
  const listed = await mcp(owner, "tools/list");
  assert.deepEqual(
    listed.data.result.tools.map((tool) => tool.name),
    [
      "haiguitang_current",
      "haiguitang_start",
      "haiguitang_status",
      "haiguitang_ask",
      "haiguitang_hint",
      "haiguitang_submit",
      "haiguitang_reveal",
      "haiguitang_next",
    ],
  );
  assert.equal(JSON.stringify(listed.data).includes("owner_id"), false);

  const noConsent = await mcp(owner, "tools/call", {
    name: "haiguitang_hint",
    arguments: { session_id: sessionId },
  });
  assert.equal(noConsent.data.result.isError, true);
  const hint = await mcp(owner, "tools/call", {
    name: "haiguitang_hint",
    arguments: { session_id: sessionId, confirmed: true },
  });
  assert.equal(toolPayload(hint.data).must_stop_this_turn, true);

  const submitted = await mcp(owner, "tools/call", {
    name: "haiguitang_submit",
    arguments: {
      session_id: sessionId,
      answer: "这是用于验证 Mock 固定评分的完整推理文本。",
      confirmed: true,
    },
  });
  const score = toolPayload(submitted.data);
  assert.equal(score.score, 72);
  assert.match(score.comment, /Mock 固定评分/);
  assert.equal(score.must_stop_this_turn, true);

  const beforeReveal = await rest(`/status?session_id=${sessionId}`, { owner });
  assert.equal("soup_bottom" in beforeReveal.data, false);
  const knownBottoms = JSON.parse(
    readFileSync(new URL("../samples/sample_soups.json", import.meta.url), "utf8"),
  ).map((soup) => soup.soup_bottom);
  assert.equal(knownBottoms.some((bottom) => JSON.stringify(beforeReveal.data).includes(bottom)), false);

  const revealed = await mcp(owner, "tools/call", {
    name: "haiguitang_reveal",
    arguments: { session_id: sessionId, confirmed: true },
  });
  const revealPayload = toolPayload(revealed.data);
  assert.equal(revealPayload.soup_bottom_revealed, true);
  assert.equal(typeof revealPayload.soup_bottom, "string");
  const refreshed = await rest(`/status?session_id=${sessionId}`, { owner });
  assert.equal(refreshed.data.soup_bottom, revealPayload.soup_bottom);
  assert.equal(refreshed.data.proactively_revealed, true);

  const errorResponse = await rest("/does-not-exist", { owner });
  assert.equal(errorResponse.response.status, 404);
  assert.equal(knownBottoms.some((bottom) => JSON.stringify(errorResponse.data).includes(bottom)), false);
});
