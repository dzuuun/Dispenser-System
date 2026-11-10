import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import {
  activateAcademicPeriod,
  updateAcademicPeriod,
} from "../controllers/academic-period.controller.js";

after(() => pool.end());

function setup(t, { currentId = 1, fail = false } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() {
      calls.push("begin");
    },
    async commit() {
      calls.push("commit");
    },
    async rollback() {
      calls.push("rollback");
    },
    release() {
      calls.push("release");
    },
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT id FROM academic_periods"))
        return [[{ id: currentId }]];
      return [{ affectedRows: 1 }];
    },
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT id, school_year"))
        return [
          [{ id: 2, schoolYear: "2026-2027", semester: "First semester" }],
        ];
      if (sql.startsWith("UPDATE students SET is_active") && fail)
        throw new Error("update failed");
      return [{ affectedRows: 1 }];
    },
  };
  t.mock.method(pool, "getConnection", async () => connection);
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return { calls, res };
}

for (const [name, handler, body] of [
  ["activate", activateAcademicPeriod, {}],
  [
    "edit",
    updateAcademicPeriod,
    { schoolYear: "2026-2027", semester: "First semester", isCurrent: true },
  ],
]) {
  test(`${name} reactivates only students assigned to the newly current period`, async (t) => {
    const { calls, res } = setup(t);
    await handler({ params: { id: "2" }, body }, res);
    const update = calls.find((call) =>
      call.sql?.startsWith("UPDATE students SET is_active"),
    );
    assert.match(update.sql, /WHERE academic_period_id=\? AND is_active=0/);
    assert.deepEqual(update.values, [2]);
    assert.ok(calls.includes("commit"));
    assert.ok(res.body);
  });
  test(`${name} does not reactivate students when the current period has not changed`, async (t) => {
    const { calls, res } = setup(t, { currentId: 2 });
    await handler({ params: { id: "2" }, body }, res);
    assert.ok(
      !calls.some((call) =>
        call.sql?.startsWith("UPDATE students SET is_active"),
      ),
    );
    assert.ok(calls.includes("commit"));
  });
  test(`${name} rolls back the period change if reactivation fails`, async (t) => {
    const { calls, res } = setup(t, { fail: true });
    await assert.rejects(
      handler({ params: { id: "2" }, body }, res),
      /update failed/,
    );
    assert.ok(calls.includes("rollback"));
    assert.ok(!calls.includes("commit"));
    assert.ok(calls.includes("release"));
  });
}
