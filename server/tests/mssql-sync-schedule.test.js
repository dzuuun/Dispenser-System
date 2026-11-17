import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import {
  runDueMssqlSync,
  fixedSyncSchedule,
  updateMssqlSyncSchedule,
  listMssqlSyncActivity,
} from "../services/mssql-sync-schedule.service.js";

after(() => pool.end());

function fakeDb({
  acquired = 1,
  due = true,
  deactivateMissingStudents = true,
  localNow = "2026-11-17 08:30:20",
  scheduledAt = "2026-11-17 08:30:00",
  enabled = true,
} = {}) {
  const calls = [];
  let released = false;
  const connection = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("GET_LOCK")) return [[{ acquired }]];
      if (sql.startsWith("SELECT deactivate_missing_students"))
        return [
          [{ deactivate_missing_students: Number(deactivateMissingStudents) }],
        ];
      if (sql.startsWith("SELECT enabled, interval_minutes"))
        return [
          [
            {
              enabled,
              interval_minutes: 60,
              deactivate_missing_students: Number(deactivateMissingStudents),
              local_now: localNow,
              scheduled_at: scheduledAt,
            },
          ],
        ];
      if (
        sql.includes("last_started_at=NOW()") &&
        sql.includes("next_run_at=?")
      )
        return [{ affectedRows: due ? 1 : 0 }];
      if (sql.startsWith("INSERT INTO mssql_sync_activity"))
        return [{ insertId: 42 }];
      return [[]];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {
      released = true;
    },
  };
  return {
    calls,
    get released() {
      return released;
    },
    getConnection: async () => connection,
  };
}

test("scheduled run claims the job and preserves birthdays", async () => {
  const db = fakeDb();
  let request;
  assert.equal(
    await runDueMssqlSync(db, async (req, res) => {
      request = req;
      res.json({ message: "Completed" });
    }),
    true,
  );
  assert.deepEqual(request.body, {
    updateExistingBirthdays: false,
    deactivateMissingStudents: true,
  });
  assert.equal(request.scheduledImport, true);
  assert.ok(
    db.calls.some(
      (call) =>
        call.sql.startsWith("UPDATE mssql_sync_activity SET finished_at") &&
        call.values[0] === "success" &&
        call.values.at(-1) === 42,
    ),
  );
  assert.ok(db.calls.some((call) => call.sql.includes("RELEASE_LOCK")));
  assert.equal(db.released, true);
});

test("not due or locked jobs do not run", async () => {
  for (const config of [{ acquired: 0 }, { due: false }]) {
    const db = fakeDb(config);
    assert.equal(
      await runDueMssqlSync(db, () => assert.fail("unexpected import")),
      false,
    );
    assert.equal(db.released, true);
  }
});

test("scheduled runs pass the disabled deactivation setting", async () => {
  await runDueMssqlSync(
    fakeDb({ deactivateMissingStudents: false }),
    async (req, res) => {
      assert.equal(req.body.deactivateMissingStudents, false);
      res.json({ message: "Done" });
    },
  );
});

test("schedule saves and returns the deactivation setting", async (t) => {
  let saved;
  t.mock.method(pool, "execute", async (_sql, values) => {
    saved = values;
  });
  t.mock.method(pool, "query", async () => [
    [
      {
        local_now: "2026-11-17 08:42:00",
        enabled: 1,
        deactivate_missing_students: 0,
        interval_minutes: 60,
      },
    ],
  ]);
  const res = {
    json(body) {
      this.body = body;
    },
  };
  await updateMssqlSyncSchedule(
    {
      body: {
        enabled: true,
        intervalMinutes: 60,
        deactivateMissingStudents: false,
      },
    },
    res,
    (error) => {
      throw error;
    },
  );
  assert.deepEqual(saved, [true, 60, false, "2026-11-17 09:30:00"]);
  assert.equal(res.body.deactivate_missing_students, false);
});

test("failed scheduled imports record failure and release the lock", async () => {
  const db = fakeDb();
  await runDueMssqlSync(db, async (_req, _res, next) =>
    next(Object.assign(new Error("No period"), { status: 400 })),
  );
  const failed = db.calls.find((call) =>
    call.sql.startsWith("UPDATE mssql_sync_activity SET finished_at"),
  );
  assert.equal(failed.values[0], "failed");
  assert.equal(failed.values.at(-2), "No period");
  assert.ok(db.calls.some((call) => call.sql.includes("RELEASE_LOCK")));
});

test("activity records run counts and marks unfinished runs interrupted", async () => {
  const db = fakeDb();
  await runDueMssqlSync(db, async (_req, res) =>
    res.json({
      message: "Done",
      period: { schoolYear: "2026-2027", term: "First semester" },
      inserted: 2,
      updated: 3,
      unchanged: 4,
      deactivated: 5,
      invalid: 1,
    }),
  );
  assert.ok(
    db.calls.some(
      (call) =>
        call.sql.includes("status='interrupted'") &&
        call.sql.includes("mssql_sync_activity"),
    ),
  );
  const done = db.calls.find((call) =>
    call.sql.startsWith("UPDATE mssql_sync_activity SET finished_at"),
  );
  assert.deepEqual(done.values, [
    "success",
    "2026-2027 · First semester",
    2,
    3,
    4,
    5,
    1,
    "Done 1 invalid row(s) skipped; review a manual preview for details.",
    42,
  ]);
});

test("activity history is paginated and rejects invalid pages", async (t) => {
  const calls = [];
  t.mock.method(pool, "query", async (sql, values) => {
    calls.push({ sql, values });
    return sql.startsWith("SELECT COUNT")
      ? [[{ total: 21 }]]
      : [[{ id: 2, status: "success" }]];
  });
  const res = {
    set() {
      return this;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await listMssqlSyncActivity({ query: { page: "2" } }, res, (error) => {
    throw error;
  });
  assert.deepEqual(calls[1].values, [20, 20]);
  assert.equal(res.body.pages, 2);
  assert.equal(res.body.rows[0].status, "success");
  await listMssqlSyncActivity({ query: { page: "0" } }, res, (error) => {
    throw error;
  });
  assert.equal(res.code, 400);
  assert.equal(calls.length, 2);
});

test("schedule updates reject invalid settings", async () => {
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await updateMssqlSyncSchedule(
    { body: { enabled: true, intervalMinutes: 1 } },
    res,
    (error) => {
      throw error;
    },
  );
  assert.equal(res.code, 400);
});

test("fixed schedules follow office hours without drifting", () => {
  for (const [now, interval, due, next] of [
    ["2026-11-21 17:01:00", 30, false, "2026-11-23 07:30:00"],
    ["2026-11-22 07:30:00", 60, false, "2026-11-23 07:30:00"],
    ["2026-11-22 12:30:00", 1440, false, "2026-11-23 07:30:00"],
    ["2026-11-17 07:29:59", 60, false, "2026-11-17 07:30:00"],
    ["2026-11-17 07:30:45", 60, true, "2026-11-17 08:30:00"],
    ["2026-11-17 08:42:00", 60, false, "2026-11-17 09:30:00"],
    ["2026-11-17 16:30:10", 60, true, "2026-11-18 07:30:00"],
    ["2026-11-17 17:00:00", 30, true, "2026-11-18 07:30:00"],
    ["2026-11-17 17:01:00", 30, false, "2026-11-18 07:30:00"],
    ["2026-11-17 23:00:00", 60, false, "2026-11-18 07:30:00"],
    ["2026-11-17 07:30:00", 1440, true, "2026-11-18 07:30:00"],
    ["2026-11-17 07:30:00", 10080, false, "2026-11-23 07:30:00"],
    ["2026-11-23 07:30:00", 10080, true, "2026-11-30 07:30:00"],
    ["2026-11-17 13:30:00", 360, true, "2026-11-18 07:30:00"],
    ["2026-11-17 07:30:00", 720, true, "2026-11-18 07:30:00"],
  ])
    assert.deepEqual(
      fixedSyncSchedule(now, interval),
      { due, nextRunAt: next },
      now,
    );
});
test("scheduler skips missed slots, outside hours, disabled schedules and already claimed slots", async () => {
  for (const config of [
    { localNow: "2026-11-22 07:30:00" },
    { localNow: "2026-11-17 06:30:00" },
    { localNow: "2026-11-17 17:30:00" },
    { localNow: "2026-11-17 08:42:00" },
    { enabled: false },
    { scheduledAt: "2026-11-17 09:30:00" },
  ]) {
    const db = fakeDb(config);
    assert.equal(
      await runDueMssqlSync(db, () => assert.fail("Unexpected import")),
      false,
    );
    assert.equal(db.released, true);
  }
});
test("claimed runs use the next fixed slot instead of the actual start time", async () => {
  const db = fakeDb();
  await runDueMssqlSync(db, async (_req, res) => res.json({ message: "Done" }));
  const claim = db.calls.find(
    (call) =>
      call.sql.includes("last_started_at=NOW()") &&
      call.sql.includes("next_run_at=?"),
  );
  assert.deepEqual(claim.values, ["2026-11-17 09:30:00"]);
});
