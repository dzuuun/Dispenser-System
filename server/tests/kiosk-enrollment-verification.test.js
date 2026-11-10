import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { verify } from "../controllers/kiosk.controller.js";

after(() => pool.end());

const activeStudent = {
  id: 7,
  student_id: "20231422",
  first_name: "Alex",
  last_name: "Smith",
  birth_date: "2000-01-01",
  course_id: 3,
  academic_period_id: 10,
  is_active: 1,
};

async function runVerification(t, student) {
  const calls = [];
  t.mock.method(pool, "query", async (sql) => {
    if (sql.includes("credential_module_controls")) return [[]];
    if (sql.includes("academic_periods")) return [[{ id: 10 }]];
    throw new Error(`Unexpected query: ${sql}`);
  });
  t.mock.method(pool, "execute", async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("FROM students")) return [student ? [student] : []];
    if (sql.includes("INSERT INTO kiosk_credential_sessions"))
      return [{ affectedRows: 1 }];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set() {
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await verify(
    {
      body: {
        studentId: "20231422",
        lastName: "Smith",
        birthDate: "2000-01-01",
        courseId: 3,
      },
    },
    res,
  );
  return { res, calls };
}

test("students outside the current period or marked inactive are directed to Records", async (t) => {
  for (const student of [
    { ...activeStudent, academic_period_id: 9 },
    { ...activeStudent, is_active: 0 },
  ]) {
    await t.test(
      `period ${student.academic_period_id}, active ${student.is_active}`,
      async (subtest) => {
        const { res, calls } = await runVerification(subtest, student);
        assert.equal(res.statusCode, 403);
        assert.match(
          res.body.message,
          /verify your enrollment status at the Records Section/i,
        );
        assert.deepEqual(calls[0].values, ["20231422", "20231422", 10]);
        assert.equal(calls.length, 1);
      },
    );
  }
});

test("a current active student can verify, while an unknown student remains not found", async (t) => {
  await t.test("current student", async (subtest) => {
    const { res, calls } = await runVerification(subtest, activeStudent);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.token);
    assert.equal(calls.length, 2);
  });
  await t.test("unknown student", async (subtest) => {
    const { res, calls } = await runVerification(subtest, null);
    assert.equal(res.statusCode, 401);
    assert.match(res.body.message, /not found/i);
    assert.equal(calls.length, 1);
  });
});
