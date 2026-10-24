import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { listStudents } from "../controllers/student-admin.controller.js";
import {
  tableSearch,
  dateSearchFields,
} from "../services/table-search.service.js";

after(() => pool.end());

function setup(t) {
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes("FROM academic_periods")) return [[{ id: 7 }]];
    if (sql.startsWith("SELECT COUNT(*)"))
      return [[{ total: 31, active_total: 20 }]];
    if (sql.startsWith("SELECT s.id"))
      return [[{ id: 11, course_code: "MIT" }]];
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
      assert.ok(!sql.includes(`LIKE '%${term}%'`));
    }
    const internalId = /^\d+$/.test(term) ? [Number(term)] : [];
    assert.deepEqual(count.values, [
      7,
      ...Array(6).fill(`%${term}%`),
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
  assert.deepEqual(count.values, [7, ...Array(6).fill("%COURSE!_100!%!!%")]);
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
