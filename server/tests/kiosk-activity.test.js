import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { kioskHeartbeat, listKiosks, getKiosk } from "../controllers/kiosk-admin.controller.js";
import { ensureKioskActivitySchema, kioskActivityReport, withKioskUsage } from "../services/kiosk-activity.service.js";

after(() => pool.end());

test("activity age is bounded and unrecognized or malformed reports fail closed", () => {
  for (const value of [null, {}, { state: "ACTIVE" }, { state: "ENTERING_DETAILS" },
    { state: "VIEWING_CREDENTIALS", idleMs: "5" },
    { state: "ENTERING_DETAILS", idleMs: -1 },
    { state: "ENTERING_DETAILS", idleMs: Infinity }]) {
    assert.throws(() => kioskActivityReport(value), { status: 400 });
  }
  assert.deepEqual(kioskActivityReport({ state: "VIEWING_CREDENTIALS", idleMs: 12_345 }),
    { state: "VIEWING_CREDENTIALS", interactionOffsetUs: -12_345_000 });
  assert.deepEqual(kioskActivityReport({ state: "ENTERING_DETAILS", idleMs: 30_000 }),
    { state: "IDLE", interactionOffsetUs: null });
  assert.deepEqual(kioskActivityReport(undefined), { state: null, interactionOffsetUs: null });
});

test("usage distinguishes active, idle, stale, older clients, and offline devices", () => {
  const base = { id: 5, is_online: 1, activity_state: "VIEWING_CREDENTIALS", activity_is_fresh: 1, has_recent_interaction: 1 };
  for (const [changes, expected] of [
    [{}, "IN_USE"],
    [{ activity_state: "ENTERING_DETAILS" }, "IN_USE"],
    [{ has_recent_interaction: 0 }, "IDLE"],
    [{ activity_state: "IDLE" }, "IDLE"],
    [{ activity_is_fresh: 0 }, "UNKNOWN"],
    [{ activity_state: null }, "UNKNOWN"],
    [{ activity_is_fresh: null }, "UNKNOWN"],
    [{ is_online: 0 }, "OFFLINE"],
  ]) {
    const result = withKioskUsage({ ...base, ...changes });
    assert.equal(result.usage_status, expected);
    assert.equal(result.id, 5);
    assert.ok(!("activity_is_fresh" in result));
  }
});

test("heartbeat records activity only for the authenticated kiosk and still delivers commands", async (t) => {
  const calls = [];
  t.mock.method(pool, "execute", async (sql, values) => {
    calls.push({ sql, values });
    return sql.startsWith("SELECT") ? [[{ id: 7, command: "RELOAD" }]] : [{ affectedRows: 1 }];
  });
  t.mock.method(pool, "query", async (sql, values) => { calls.push({ sql, values }); return [{}]; });
  let body;
  await kioskHeartbeat({ kioskId: 5, headers: {}, socket: {}, get: () => "Chrome",
    body: { kioskId: 99, activity: { state: "ENTERING_DETAILS", idleMs: 5000 } } },
  { set() { return this; }, json(value) { body = value; } });
  assert.match(calls[0].sql, /activity_reported_at=NOW\(\)/);
  assert.match(calls[0].sql, /last_interaction_at=TIMESTAMPADD\(MICROSECOND, \?, NOW\(\)\) WHERE id=\?/);
  assert.deepEqual(calls[0].values.slice(-3), ["ENTERING_DETAILS", -5_000_000, 5]);
  assert.deepEqual(body.commands, [{ id: 7, command: "RELOAD" }]);
  assert.deepEqual(calls.at(-1).values, [7]);
});

test("invalid heartbeat activity cannot overwrite an existing report", async (t) => {
  const execute = t.mock.method(pool, "execute", async () => { throw new Error("Unexpected write"); });
  await assert.rejects(kioskHeartbeat({ body: { activity: { state: "BOGUS" } } }, {}), { status: 400 });
  assert.equal(execute.mock.callCount(), 0);
});

test("list and details derive activity freshness using database time", async (t) => {
  const calls = [];
  const kiosk = { id: 5, is_online: 1, activity_state: "VIEWING_CREDENTIALS", activity_is_fresh: 1, has_recent_interaction: 1 };
  const run = async (sql) => {
    calls.push(sql);
    return sql.includes("FROM kiosks") ? [[kiosk]] : [[]];
  };
  t.mock.method(pool, "query", run);
  t.mock.method(pool, "execute", run);
  let body;
  const res = { set() { return this; }, json(value) { body = value; } };
  await listKiosks({}, res);
  assert.equal(body[0].usage_status, "IN_USE");
  await getKiosk({ params: { id: 5 } }, res);
  assert.equal(body.kiosk.usage_status, "IN_USE");
  for (const sql of calls.filter((query) => query.includes("FROM kiosks"))) {
    assert.match(sql, /activity_reported_at >= DATE_SUB\(NOW\(\), INTERVAL 20 SECOND\)/);
    assert.match(sql, /last_interaction_at > DATE_SUB\(NOW\(\), INTERVAL 30 SECOND\)/);
  }
});

test("activity schema setup is additive, repeatable, and handles concurrent startup", async () => {
  const columns = new Set(["activity_state"]);
  const alters = [];
  const executor = { async query(sql) {
    if (sql.startsWith("SELECT")) return [[...columns].map((COLUMN_NAME) => ({ COLUMN_NAME }))];
    assert.match(sql, /^ALTER TABLE kiosks ADD COLUMN/);
    alters.push(sql);
    columns.add(sql.split(" ")[5]);
    if (alters.length === 1) throw Object.assign(new Error("Concurrent migration"), { code: "ER_DUP_FIELDNAME" });
    return [{}];
  } };
  await ensureKioskActivitySchema(executor);
  await ensureKioskActivitySchema(executor);
  assert.equal(alters.length, 2);
  assert.deepEqual([...columns], ["activity_state", "activity_reported_at", "last_interaction_at"]);
  await assert.rejects(ensureKioskActivitySchema({ query: async () => { throw new Error("Database unavailable"); } }), /Database unavailable/);
});
