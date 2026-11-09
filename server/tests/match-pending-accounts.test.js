import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { encryptPassword } from "../services/encryption.service.js";
import { matchPendingAccounts } from "../services/match-pending-accounts.service.js";
import { matchStudentAccounts } from "../controllers/student-admin.controller.js";

after(() => pool.end());

function fixture() {
  const secret = encryptPassword("test password");
  const rows = [
    { id: 1, account_type: "schoology", school_id: "001", account_name: "001", ...secret },
    { id: 2, account_type: "email", school_id: "002", account_name: "existing@example.edu", ...secret },
    { id: 3, account_type: "email", school_id: "003", account_name: "owned@example.edu", ...secret },
    { id: 4, account_type: "satp", school_id: "missing", account_name: "missing", ...secret },
    { id: 5, account_type: "email", school_id: "001", account_name: "Not Found", ...secret },
    { id: 6, account_type: "satp", school_id: "001", account_name: "001", encrypted_password: "bad", password_iv: "bad", password_auth_tag: "bad" },
  ];
  const writes = [];
  return {
    rows, writes,
    async query(sql) {
      if (sql.includes("FROM pending_account_imports")) return [rows];
      if (sql === "SELECT id, student_id FROM students") return [[{ id: 1, student_id: "001" }, { id: 2, student_id: "002" }, { id: 3, student_id: "003" }]];
      throw new Error(sql);
    },
    async execute(sql, values) {
      if (sql.startsWith("SELECT student_id")) {
        if (values[0] === 2) return [[{ student_id: 2 }]];
        if (values[0] === 3) return [[{ student_id: 9 }]];
        return [[]];
      }
      writes.push({ sql, values });
      return [{ affectedRows: 1 }];
    },
  };
}

test("matches pending accounts safely and retains unmatched or conflicting rows", async () => {
  const connection = fixture();
  const result = await matchPendingAccounts(connection);
  assert.deepEqual(result, { matched: 1, unmatched: 1, existing: 1, conflicts: 1, invalid: 2 });
  assert.equal(connection.writes.length, 2);
  assert.match(connection.writes[0].sql, /^INSERT INTO schoology_accounts/);
  assert.deepEqual(connection.writes[1].values, [1]);
});

test("match action rolls back if a database write fails", async (t) => {
  const connection = fixture();
  let rolledBack = false, committed = false, released = false;
  connection.beginTransaction = async () => {};
  connection.commit = async () => { committed = true; };
  connection.rollback = async () => { rolledBack = true; };
  connection.release = () => { released = true; };
  const execute = connection.execute;
  connection.execute = async (sql, values) => {
    if (sql.startsWith("DELETE FROM pending_account_imports")) throw new Error("Write failure");
    return execute.call(connection, sql, values);
  };
  t.mock.method(pool, "getConnection", async () => connection);
  await assert.rejects(matchStudentAccounts({}, {}), /Write failure/);
  assert.equal(rolledBack, true);
  assert.equal(committed, false);
  assert.equal(released, true);
});

test("match treats an uncreated pending table as an empty queue", async () => {
  const result = await matchPendingAccounts({ query: async () => { throw Object.assign(new Error("missing"), { code: "ER_NO_SUCH_TABLE" }); } });
  assert.deepEqual(result, { matched: 0, unmatched: 0, existing: 0, conflicts: 0, invalid: 0 });
});
