import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { listStudents } from "../controllers/student-admin.controller.js";
import {
  tableSearch,
  dateSearchFields,
} from "../services/table-search.service.js";

after(() => pool.end());

function setup(t, records = [{ id: 11, course_code: "MIT" }]) {
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("FROM academic_periods")) return [[{ id: 7 }]];
    if (sql.startsWith("SELECT COUNT(*)"))
      return [[{ total: 31, active_total: 20 }]];
    if (sql.startsWith("SELECT s.id")) return [records];
    throw new Error(sql);
  };
  t.mock.method(pool, "query", query);
  t.mock.method(pool, "execute", query);
  const get = async (search, extra = {}) => {
    let body;
    await listStudents(
      { query: { search, status: "all", page: "2", limit: "10", ...extra } },
      {
        json(value) {
          body = value;
        },
      },
    );
    return body;
  };
  return { calls, get };
}

test("student search covers IDs, full names, course code/name, and displayed status before counting and paging", async (t) => {
  const { calls, get } = setup(t);
  for (const term of [
    "2011100",
    "Test Middle Student",
    "MIT",
    "Master in Information Technology",
    "Inactive",
    "Email",
    "Kumosoft",
    "Schoology",
    "SATP",
    "Email (inactive)",
    "No linked accounts",
  ]) {
    const first = calls.length;
    const result = await get(term);
    assert.equal(result.page, 2);
    assert.equal(result.pages, 4);
    const [count, listing] = calls
      .slice(first)
      .filter(({ sql }) => sql.includes("FROM students s"));
    for (const { sql } of [count, listing]) {
      assert.match(sql, /JOIN courses c ON c.id=s.course_id/);
      assert.match(sql, /s\.academic_period_id=\?/);
      for (const field of ["s.student_id", "s.kumosoft_id", "c.code", "c.name"])
        assert.ok(sql.includes(`${field} LIKE ? ESCAPE '!'`));
      assert.match(sql, /NULLIF\(s.middle_name, ''\)/);
      assert.match(
        sql,
        /CASE WHEN s.is_active=1 THEN 'Active' ELSE 'Inactive' END LIKE \?/,
      );
      for (const table of [
        "institutional_email_accounts",
        "kumosoft_accounts",
        "schoology_accounts",
        "satp_accounts",
      ])
        assert.ok(sql.includes("LEFT JOIN " + table));
      assert.match(sql, /THEN 'No linked accounts'/);
      assert.ok(!sql.includes(`LIKE '%${term}%'`));
    }
    const internalId = /^\d+$/.test(term) ? [Number(term)] : [];
    assert.deepEqual(count.values, [
      7,
      ...Array(11).fill(`%${term}%`),
      ...internalId,
    ]);
    assert.deepEqual(listing.values, [...count.values, 10, 10]);
  }
});

test("student search preserves status filters and treats LIKE wildcard characters literally", async (t) => {
  const { calls, get } = setup(t);
  await get("  COURSE_100%!  ", { status: "inactive" });
  const count = calls.find(({ sql }) => sql.startsWith("SELECT COUNT(*)"));
  assert.match(count.sql, /AND s.is_active=0/);
  assert.deepEqual(count.values, [7, ...Array(11).fill("%COURSE!_100!%!!%")]);
});

test("empty student search retains the lightweight unjoined count", async (t) => {
  const { calls, get } = setup(t);
  await get("   ");
  const count = calls.find(({ sql }) => sql.startsWith("SELECT COUNT(*)"));
  assert.doesNotMatch(count.sql, /JOIN|LIKE/);
  assert.deepEqual(count.values, [7]);
});

test("invalid student searches are rejected before a database query", async (t) => {
  const { calls, get } = setup(t);
  for (const term of ["a".repeat(201), ["one", "two"], { value: "term" }])
    await assert.rejects(get(term), { status: 400 });
  assert.equal(calls.length, 0);
});

test("missing account filters apply to both counts and pages and combine with search and student status", async (t) => {
  const { calls, get } = setup(t);
  for (const [type, table] of [
    ["EMAIL", "institutional_email_accounts"],
    ["KUMOSOFT", "kumosoft_accounts"],
    ["SCHOOLOGY", "schoology_accounts"],
    ["SATP", "satp_accounts"],
  ]) {
    const first = calls.length;
    await get("BSIT", { missingAccount: type, status: "inactive" });
    const [count, listing] = calls
      .slice(first)
      .filter(({ sql }) => sql.includes("FROM students s"));
    for (const { sql } of [count, listing]) {
      assert.ok(
        sql.includes(
          `NOT EXISTS (SELECT 1 FROM ${table} missing_account WHERE missing_account.student_id=s.id)`,
        ),
      );
      assert.equal((sql.match(/NOT EXISTS/g) || []).length, 1);
      assert.match(sql, /s\.academic_period_id=\?/);
      assert.match(sql, /AND s\.is_active=0/);
      // An inactive linked account still exists; it must not count as missing.
      assert.doesNotMatch(sql, /missing_account\.is_active/);
    }
    assert.deepEqual(count.values, [7, ...Array(11).fill("%BSIT%")]);
    assert.deepEqual(listing.values, [...count.values, 10, 10]);
  }
});

test("no linked accounts requires every account to be absent without adding joins to an unsearched count", async (t) => {
  const { calls, get } = setup(t);
  await get("", { missingAccount: "NONE", page: "1" });
  const [count, listing] = calls.filter(({ sql }) =>
    sql.includes("FROM students s"),
  );
  for (const { sql } of [count, listing])
    assert.equal((sql.match(/NOT EXISTS/g) || []).length, 4);
  assert.doesNotMatch(count.sql, /JOIN/);
  assert.deepEqual(count.values, [7]);
  assert.deepEqual(listing.values, [7, 10, 0]);
});

test("invalid missing account filters are rejected before querying the database", async (t) => {
  const { calls, get } = setup(t);
  for (const missingAccount of [
    "OTHER",
    "EMAIL OR 1=1",
    ["EMAIL", "SATP"],
    { type: "EMAIL" },
    1,
  ])
    await assert.rejects(get("", { missingAccount }), { status: 400 });
  assert.equal(calls.length, 0);
});

test("student rows report linked accounts including inactive ones without fetching passwords", async (t) => {
  const { calls, get } = setup(t, [
    {
      id: 11,
      email_account_active: 1,
      kumosoft_account_active: 0,
      schoology_account_active: 1,
      satp_account_active: 1,
    },
    {
      id: 12,
      email_account_active: null,
      kumosoft_account_active: null,
      schoology_account_active: null,
      satp_account_active: null,
    },
    {
      id: 13,
      email_account_active: null,
      kumosoft_account_active: 1,
      schoology_account_active: null,
      satp_account_active: null,
    },
  ]);
  const result = await get("");
  assert.deepEqual(result.rows, [
    {
      id: 11,
      linkedAccounts: [
        { type: "EMAIL", isActive: true },
        { type: "KUMOSOFT", isActive: false },
        { type: "SCHOOLOGY", isActive: true },
        { type: "SATP", isActive: true },
      ],
    },
    { id: 12, linkedAccounts: [] },
    { id: 13, linkedAccounts: [{ type: "KUMOSOFT", isActive: true }] },
  ]);
  const listing = calls.find(({ sql }) => sql.startsWith("SELECT s.id"));
  assert.doesNotMatch(
    listing.sql,
    /encrypted_password|password_iv|password_auth_tag/,
  );
  assert.deepEqual(listing.values, [7, 10, 10]);
  const drawResult = await get("", { draw: "2", start: "0", length: "10" });
  assert.deepEqual(drawResult.data, result.rows);
  assert.equal(drawResult.draw, 2);
});

test("search values are normalized and escaped separately from application-owned SQL", () => {
  const search = tableSearch("  A_%!   ' OR 1=1  ", ["s.student_id", "c.code"]);
  assert.equal(search.term, "A_%! ' OR 1=1");
  assert.deepEqual(search.values, ["%A!_!%!! ' OR 1=1%", "%A!_!%!! ' OR 1=1%"]);
  assert.doesNotMatch(search.sql, /OR 1=1/);
  assert.equal(tableSearch("  ", ["field"]).sql, "");
});

test("date search supports displayed dates, padded request times, and 24-hour timestamps", () => {
  assert.ok(
    dateSearchFields("pr.requested_at", { minuteOnly: true }).includes(
      "DATE_FORMAT(pr.requested_at, '%c/%e/%Y, %h:%i %p')",
    ),
  );
  assert.ok(
    dateSearchFields("t.created_at").includes(
      "DATE_FORMAT(t.created_at, '%c/%e/%Y, %l:%i:%s %p')",
    ),
  );
  assert.ok(
    dateSearchFields("w.assigned_at").includes(
      "DATE_FORMAT(w.assigned_at, '%Y-%m-%d %H:%i:%s')",
    ),
  );
});
