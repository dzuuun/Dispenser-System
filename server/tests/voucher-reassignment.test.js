import assert from "node:assert/strict";
import { after, test } from "node:test";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { config } from "../config/env.js";
import { releaseVoucher } from "../controllers/voucher-admin.controller.js";
import {
  generateStudentVoucher,
  updateStudent,
} from "../controllers/student-admin.controller.js";
import { completePasswordResetRequest } from "../controllers/password-reset.controller.js";
import {
  credentials,
  revealCredentials,
} from "../controllers/kiosk.controller.js";
import { REQUEST_PERMISSION_KEYS } from "../../shared/request-permissions.mjs";

after(() => pool.end());
const reviewToken = "a".repeat(64);
const response = () => ({
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
});

function setup(t, options = {}) {
  const makeVoucher = (id, extra = {}) => ({
    id,
    voucher_code: `TEST-${id}`,
    academic_period_id: 7,
    is_active: 1,
    is_assigned: 0,
    is_released: 0,
    assigned_at: null,
    released_at: null,
    ...extra,
  });
  let stored = {
    students: {
      1: { id: 1, voucher_id: 10, academic_period_id: 7 },
      2: { id: 2, voucher_id: 14, academic_period_id: 7 },
    },
    vouchers: {
      10: makeVoucher(10, { is_assigned: 1, assigned_at: "original" }),
      11: makeVoucher(11),
      12: makeVoucher(12, { is_active: 0 }),
      13: makeVoucher(13, { is_released: 1 }),
      14: makeVoucher(14, { is_assigned: 1 }),
      15: makeVoucher(15, { academic_period_id: 6 }),
    },
    completed: false,
  };
  const calls = [];
  let queue = Promise.resolve();
  const run = async (data, sql, values = []) => {
    calls.push({ sql, values });
    if (sql.includes("FROM academic_periods")) return [[{ id: 7 }]];
    if (
      sql.startsWith(
        "SELECT id FROM students WHERE voucher_id=? AND academic_period_id=?",
      )
    )
      return [
        Object.values(data.students).filter(
          (s) =>
            s.voucher_id === values[0] && s.academic_period_id === values[1],
        ),
      ];
    if (
      sql.startsWith("SELECT id, is_assigned, is_released FROM wifi_vouchers")
    )
      return [
        Object.values(data.vouchers).filter(
          (w) => w.id === values[0] && w.academic_period_id === values[1],
        ),
      ];
    if (
      sql.startsWith("SELECT w.id, w.voucher_code") ||
      sql.startsWith("SELECT id, voucher_code FROM wifi_vouchers") ||
      sql.startsWith("SELECT id FROM wifi_vouchers")
    ) {
      assert.match(sql, /FOR UPDATE$/);
      const release = sql.startsWith("SELECT w.id");
      const periodId = release
        ? values[0]
        : data.students[values[0]]?.academic_period_id;
      return [
        Object.values(data.vouchers)
          .filter(
            (w) =>
              w.academic_period_id === periodId &&
              w.is_active &&
              !w.is_assigned &&
              !w.is_released &&
              (!release ||
                (w.id !== values[1] &&
                  !Object.values(data.students).some(
                    (s) => s.voucher_id === w.id,
                  ))),
          )
          .sort((a, b) => a.id - b.id)
          .slice(0, release ? values[2] : 1),
      ];
    }
    if (sql.startsWith("SELECT id, is_assigned, is_active FROM wifi_vouchers"))
      return [
        Object.values(data.vouchers).filter(
          (w) =>
            w.voucher_code === values[0] &&
            w.academic_period_id ===
              data.students[values[1]]?.academic_period_id,
        ),
      ];
    if (sql.startsWith("SELECT id FROM students WHERE voucher_id=? AND id<>?"))
      return [
        Object.values(data.students).filter(
          (s) => s.voucher_id === values[0] && s.id !== values[1],
        ),
      ];
    if (
      /^SELECT (id, voucher_id|voucher_id) FROM students WHERE id=\?/.test(sql)
    )
      return [
        data.students[values[0]] ? [{ ...data.students[values[0]] }] : [],
      ];
    if (sql.startsWith("SELECT id FROM courses")) return [[{ id: 1 }]];
    if (sql.startsWith("UPDATE students SET student_id="))
      return [{ affectedRows: data.students[values.at(-1)] ? 1 : 0 }];
    if (/^UPDATE (satp|schoology|kumosoft)_accounts SET username/.test(sql))
      return [{ affectedRows: 0 }];
    if (sql.startsWith("UPDATE students SET voucher_id=?")) {
      if (options.failAssignment) throw new Error("Assignment failed");
      data.students[values[1]].voucher_id = values[0];
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE students SET voucher_id=NULL")) {
      data.students[values[0]].voucher_id = null;
      return [{ affectedRows: 1 }];
    }
    const retire = (voucher) =>
      Object.assign(voucher, {
        is_active: 0,
        is_assigned: 0,
        is_released: 1,
        released_at: voucher.released_at || "now",
      });
    if (sql.startsWith("UPDATE wifi_vouchers w JOIN students")) {
      const voucher = data.vouchers[data.students[values[0]]?.voucher_id];
      if (
        voucher &&
        (voucher.is_released ||
          !voucher.is_active ||
          voucher.academic_period_id !==
            data.students[values[0]].academic_period_id)
      )
        retire(voucher);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("UPDATE wifi_vouchers SET")) {
      const voucher = data.vouchers[values.at(-1)];
      if (
        sql.includes("is_active=0") ||
        (sql.includes("is_active=IF") && values[0])
      )
        voucher.is_active = 0;
      for (const field of ["is_assigned", "is_released"]) {
        if (sql.includes(`${field}=0`)) voucher[field] = 0;
        if (sql.includes(`${field}=1`)) voucher[field] = 1;
      }
      for (const field of ["assigned_at", "released_at"]) {
        if (sql.includes(`${field}=NOW()`)) voucher[field] = "now";
        if (sql.includes(`${field}=NULL`)) voucher[field] = null;
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("SELECT student_id, credential_type, request_kind"))
      return [
        [
          {
            student_id: 1,
            credential_type: "VOUCHER",
            request_kind: "VOUCHER_REQUEST",
          },
        ],
      ];
    if (sql.startsWith("SELECT r."))
      return [[{ admin_user_id: 1, review_token: reviewToken, is_live: 1 }]];
    if (sql.startsWith("DELETE FROM credential_request_reviews"))
      return [{ affectedRows: 1 }];
    if (sql.startsWith("UPDATE password_reset_requests")) {
      if (options.failCompletion) throw new Error("Completion failed");
      data.completed = true;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM kiosk_credential_sessions"))
      return [[{ student_id: 1 }]];
    if (sql.includes("FROM credential_module_controls"))
      return [[{ module_key: "VOUCHER", is_visible: 1, is_maintenance: 0 }]];
    if (sql.includes("FROM students s JOIN courses"))
      return [
        [
          {
            student_id: "TEST-1",
            first_name: "Test",
            academic_level: "COLLEGE",
          },
        ],
      ];
    if (
      sql.includes("'SATP' credential_type") ||
      sql.includes("FROM password_reset_requests")
    )
      return [[]];
    if (sql.startsWith("SELECT w.voucher_code")) {
      assert.match(sql, /w\.is_released=0/);
      assert.match(sql, /w\.is_active=1/);
      assert.match(sql, /w\.academic_period_id=s\.academic_period_id/);
      const student = data.students[values[0]],
        voucher = data.vouchers[student?.voucher_id];
      return [
        voucher?.is_active &&
        !voucher.is_released &&
        voucher.academic_period_id === student.academic_period_id
          ? [{ voucher_code: voucher.voucher_code }]
          : [],
      ];
    }
    if (sql.startsWith("INSERT INTO credential_transactions"))
      return [{ affectedRows: 1 }];
    if (sql.includes("SELECT academic_period_id FROM students"))
      return [[{ academic_period_id: 7 }]];
    throw new Error(sql);
  };
  t.mock.method(pool, "getConnection", async () => {
    let staged, unlock;
    return {
      async beginTransaction() {
        const previous = queue;
        queue = new Promise((resolve) => {
          unlock = resolve;
        });
        await previous;
        staged = structuredClone(stored);
      },
      async execute(sql, values) {
        return run(staged, sql, values);
      },
      async query(sql, values) {
        return run(staged, sql, values);
      },
      async commit() {
        stored = staged;
        staged = undefined;
        unlock();
      },
      async rollback() {
        staged = undefined;
        unlock();
      },
      release() {
        assert.equal(
          staged,
          undefined,
          "Transaction must finish before returning the connection",
        );
      },
    };
  });
  t.mock.method(pool, "execute", (sql, values) => run(stored, sql, values));
  t.mock.method(pool, "query", (sql, values) => run(stored, sql, values));
  return {
    get state() {
      return stored;
    },
    calls,
  };
}

const release = async (id = 10) => {
  const res = response();
  await releaseVoucher({ params: { id: String(id) } }, res);
  return res;
};
const assertReplaced = (store, studentId = 1, newId = 11) => {
  assert.equal(store.state.students[studentId].voucher_id, newId);
  assert.equal(store.state.vouchers[10].is_active, 0);
  assert.equal(store.state.vouchers[10].is_assigned, 0);
  assert.equal(store.state.vouchers[10].is_released, 1);
  assert.equal(store.state.vouchers[newId].is_active, 1);
  assert.equal(store.state.vouchers[newId].is_assigned, 1);
  assert.equal(store.state.vouchers[newId].is_released, 0);
  assert.equal(store.state.vouchers[newId].released_at, null);
};

test("releasing an assigned voucher retires it and immediately assigns another code atomically", async (t) => {
  const store = setup(t);
  const res = await release();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reassigned, 1);
  assert.deepEqual(res.body.replacements, [
    { studentId: 1, voucherCode: "TEST-11" },
  ]);
  assertReplaced(store);
  assert.equal(store.state.vouchers[10].assigned_at, "original");
  const locks = store.calls.filter(({ sql }) => sql.includes("FOR UPDATE"));
  assert.match(locks[0].sql, /FROM students/);
  assert.match(locks[2].sql, /NOT EXISTS/);
});

test("a repeated release does not replace the student's new voucher again", async (t) => {
  const store = setup(t);
  const results = await Promise.all([release(), release()]);
  assert.deepEqual(
    results.map((r) => r.body.reassigned),
    [1, 0],
  );
  assertReplaced(store);
});

test("no stock preserves the student's original assignment and all voucher flags", async (t) => {
  const store = setup(t);
  delete store.state.vouchers[11];
  const before = structuredClone(store.state);
  const res = await release();
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /current assignment was kept/);
  assert.deepEqual(store.state, before);
});

test("replacement stock excludes codes linked to someone else even if their assigned flag is stale", async (t) => {
  const store = setup(t);
  store.state.students[2].voucher_id = 11;
  const res = await release();
  assert.equal(res.statusCode, 409);
  assert.equal(store.state.students[1].voucher_id, 10);
  assert.equal(store.state.students[2].voucher_id, 11);
});

test("all legacy holders receive distinct replacements, or the complete release is rolled back", async (t) => {
  const store = setup(t);
  store.state.students[2].voucher_id = 10;
  assert.equal((await release()).statusCode, 409);
  store.state.vouchers[14].is_assigned = 0;
  const res = await release();
  assert.equal(res.body.reassigned, 2);
  assertReplaced(store);
  assertReplaced(store, 2, 14);
});

test("an assignment error rolls back both retiring the old voucher and reserving its replacement", async (t) => {
  const store = setup(t, { failAssignment: true });
  const before = structuredClone(store.state);
  await assert.rejects(release(), /Assignment failed/);
  assert.deepEqual(store.state, before);
});

test("unknown and other-period vouchers return 404 without mutation", async (t) => {
  const store = setup(t);
  const before = structuredClone(store.state);
  for (const id of [999, 15]) assert.equal((await release(id)).statusCode, 404);
  assert.deepEqual(store.state, before);
});

test("releasing an unassigned code does not allocate a voucher to an unrelated student", async (t) => {
  const store = setup(t);
  const res = await release(11);
  assert.equal(res.body.reassigned, 0);
  assert.equal(store.state.students[1].voucher_id, 10);
  assert.equal(store.state.vouchers[11].is_released, 1);
});

for (const stocked of [true, false])
  test(`student voucher generation retires the old code only when a replacement exists: ${stocked}`, async (t) => {
    const store = setup(t);
    if (!stocked) delete store.state.vouchers[11];
    const before = structuredClone(store.state),
      res = response();
    await generateStudentVoucher({ params: { id: "1" } }, res);
    if (stocked) assertReplaced(store);
    else {
      assert.equal(res.statusCode, 400);
      assert.deepEqual(store.state, before);
    }
  });

for (const change of [{ assignNextVoucher: true }, { voucherCode: "TEST-11" }])
  test(`editing a student retires the used code when replacing it: ${JSON.stringify(change)}`, async (t) => {
    const store = setup(t),
      res = response();
    await updateStudent(
      {
        params: { id: "1" },
        body: {
          studentId: "TEST-1",
          firstName: "Test",
          lastName: "Student",
          birthDate: "2005-01-01",
          courseId: 1,
          ...change,
        },
      },
      res,
    );
    assert.equal(res.statusCode, 200);
    assertReplaced(store);
  });

for (const failCompletion of [false, true])
  test(`approved voucher replacement retires the old code with request completion atomically: failure=${failCompletion}`, async (t) => {
    const store = setup(t, { failCompletion }),
      before = structuredClone(store.state),
      res = response();
    const complete = () =>
      completePasswordResetRequest(
        {
          params: { id: "1" },
          admin: { sub: 1, requestPermissions: [...REQUEST_PERMISSION_KEYS] },
          body: { reviewToken },
        },
        res,
      );
    if (failCompletion) {
      await assert.rejects(complete(), /Completion failed/);
      assert.deepEqual(store.state, before);
    } else {
      await complete();
      assert.equal(res.statusCode, 200);
      assertReplaced(store);
      assert.equal(store.state.completed, true);
    }
  });

const kioskRequest = () => ({
  headers: {
    authorization: `Bearer ${jwt.sign({ sub: 1, jti: "test", scope: "kiosk-credentials" }, config().accessSecret)}`,
  },
  body: {},
  header: () => "test",
});

test("the kiosk replaces a legacy released voucher and never reveals the retired code", async (t) => {
  const store = setup(t);
  store.state.vouchers[10].is_released = 1;
  const summary = response();
  await credentials(kioskRequest(), summary);
  assert.equal(summary.statusCode, 200);
  assert.equal(summary.body.hasWifiVoucher, true);
  assertReplaced(store);
  const reveal = response();
  await revealCredentials(kioskRequest(), reveal);
  assert.equal(reveal.body.wifiVoucher, "TEST-11");
});

test("a released linked code is not revealed when replacement stock is unavailable", async (t) => {
  const store = setup(t);
  store.state.vouchers[10].is_released = 1;
  delete store.state.vouchers[11];
  const summary = response();
  await credentials(kioskRequest(), summary);
  assert.equal(summary.body.hasWifiVoucher, false);
  assert.equal(summary.body.voucherState, "PENDING");
  const reveal = response();
  await revealCredentials(kioskRequest(), reveal);
  assert.equal(reveal.body.wifiVoucher, null);
});

test("concurrent kiosk refreshes keep a single replacement for a stale released link", async (t) => {
  const store = setup(t);
  store.state.vouchers[10].is_released = 1;
  const results = [response(), response()];
  await Promise.all(results.map((res) => credentials(kioskRequest(), res)));
  assert.ok(
    results.every((res) => res.statusCode === 200 && res.body.hasWifiVoucher),
  );
  assertReplaced(store);
  assert.equal(
    store.calls.filter(({ sql }) =>
      sql.startsWith("SELECT id, voucher_code FROM wifi_vouchers"),
    ).length,
    1,
  );
  assert.ok(
    store.calls
      .filter(({ sql }) => sql.startsWith("SELECT w.voucher_code"))
      .every(({ sql }) => sql.endsWith("FOR UPDATE")),
  );
});
