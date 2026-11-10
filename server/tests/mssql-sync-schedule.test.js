import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import {
  runDueMssqlSync,
  updateMssqlSyncSchedule,
} from "../services/mssql-sync-schedule.service.js";

after(() => pool.end());

function fakeDb({ acquired = 1, due = true } = {}) {
  const calls = [];
  let released = false;
  const connection = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("GET_LOCK")) return [[{ acquired }]];
      if (sql.includes("next_run_at=DATE_ADD"))
        return [{ affectedRows: due ? 1 : 0 }];
      return [[]];
    },
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
  assert.deepEqual(request.body, { updateExistingBirthdays: false });
  assert.equal(request.scheduledImport, true);
  assert.ok(
    db.calls.some((call) => call.sql.includes("last_status='success'")),
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

test("failed scheduled imports record failure and release the lock", async () => {
  const db = fakeDb();
  await runDueMssqlSync(db, async (_req, _res, next) =>
    next(Object.assign(new Error("No period"), { status: 400 })),
  );
  const failed = db.calls.find((call) =>
    call.sql.includes("last_status='failed'"),
  );
  assert.deepEqual(failed.values, ["No period"]);
  assert.ok(db.calls.some((call) => call.sql.includes("RELEASE_LOCK")));
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
