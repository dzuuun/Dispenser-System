import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { listPasswordResetRequests } from "../controllers/password-reset.controller.js";
import { encryptPassword } from "../services/encryption.service.js";

after(() => pool.end());

function setup(
  t,
  permissions = ["EMAIL:PASSWORD_RESET", "KUMOSOFT:ACCOUNT_CREATION"],
) {
  const calls = [];
  t.mock.method(pool, "query", async (sql, values) => {
    calls.push({ sql, values });
    return [
      [
        {
          id: 1,
          credential_type: "EMAIL",
          request_kind: "PASSWORD_RESET",
          kiosk_code: "KIOSK-MIS-01",
          kiosk_location: "ICT/MIS Office",
          ...encryptPassword("saved-secret"),
        },
      ],
    ];
  });
  const get = async (search) => {
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
    await listPasswordResetRequests(
      {
        query: search === undefined ? {} : { search },
        admin: { requestPermissions: permissions },
      },
      res,
    );
    return res;
  };
  return { calls, get };
}

test("request search covers all displayed fields, dates, statuses and administrator names before the row limit", async (t) => {
  const { calls, get } = setup(t);
  const res = await get("  Test   Student  ");
  assert.equal(res.statusCode, 200);
  const [{ sql, values }] = calls;
  assert.equal(res.body[0].kiosk_location, "ICT/MIS Office");
  assert.match(sql, /LEFT JOIN kiosks k ON k\.kiosk_code=pr\.kiosk_code/);
  assert.match(sql, /COALESCE\(NULLIF\(TRIM\(k\.location\), ''\), 'Unassigned'\) AS kiosk_location/);
  const where = sql.slice(sql.indexOf("WHERE "));
  assert.match(where, /s\.student_id LIKE \?/);
  assert.match(
    where,
    /CONCAT_WS\(' ', NULLIF\(s\.first_name, ''\), NULLIF\(NULLIF\(TRIM\(s\.middle_name\), '-'\), ''\), NULLIF\(s\.last_name, ''\)\) LIKE \?/,
  );
  assert.match(where, /c\.code LIKE \?/);
  assert.match(where, /pr\.credential_type LIKE \?/);
  assert.match(where, /THEN 'WiFi Voucher'/);
  assert.match(where, /THEN 'Replacement request'/);
  assert.match(where, /pr\.status LIKE \?/);
  assert.match(where, /THEN au\.full_name/);
  assert.match(where, /reviewer\.full_name/);
  assert.match(where, /Being reviewed Reviewing:/);
  assert.match(
    where,
    /DATE_FORMAT\(pr\.requested_at, '%c\/%e\/%Y, %h:%i %p'\)/,
  );
  assert.match(
    where,
    /DATE_FORMAT\(CASE WHEN pr\.status<>'PENDING' THEN pr\.resolved_at END/,
  );
  assert.match(where, /REPLACE\(pr\.request_kind, '_', ' '\) LIKE \?/);
  for (const field of [
    "satp.username",
    "schoology.username",
    "kumosoft.username",
    "email.email_address",
    "voucher.voucher_code",
  ])
    assert.ok(where.includes(field));
  assert.equal((where.match(/LIKE \? ESCAPE '!'/g) || []).length, 25);
  assert.ok(where.lastIndexOf("LIKE ?") < where.indexOf("LIMIT 500"));
  assert.doesNotMatch(
    where,
    /encrypted_password|password_iv|password_auth_tag|saved-secret/,
  );
  assert.deepEqual(values, [
    "EMAIL",
    "PASSWORD_RESET",
    "KUMOSOFT",
    "ACCOUNT_CREATION",
    ...Array(25).fill("%Test Student%"),
  ]);
  assert.equal(res.body[0].default_password, "saved-secret");
  assert.equal("encrypted_password" in res.body[0], false);
});

test("search binds wildcards and SQL characters literally without changing request permissions", async (t) => {
  const { calls, get } = setup(t);
  const term = "ID_100%! ' OR 1=1 --";
  assert.equal((await get(term)).statusCode, 200);
  const [{ sql, values }] = calls;
  assert.doesNotMatch(sql, /OR 1=1/);
  assert.match(
    sql,
    /WHERE \(\(pr\.credential_type=\? AND pr\.request_kind=\?\) OR \(pr\.credential_type=\? AND pr\.request_kind=\?\)\) AND \(/,
  );
  assert.deepEqual(values.slice(0, 4), [
    "EMAIL",
    "PASSWORD_RESET",
    "KUMOSOFT",
    "ACCOUNT_CREATION",
  ]);
  assert.deepEqual(
    values.slice(4),
    Array(25).fill("%ID!_100!%!! ' OR 1=1 --%"),
  );
});

test("no request permissions remain restrictive when search is supplied", async (t) => {
  const { calls, get } = setup(t, []);
  await get("Email");
  assert.match(calls[0].sql, /WHERE 1=0 AND \(/);
  assert.deepEqual(calls[0].values, Array(25).fill("%Email%"));
});

test("empty and omitted searches preserve the existing array response and unfiltered query", async (t) => {
  const { calls, get } = setup(t);
  for (const term of [undefined, "", "   "]) {
    const res = await get(term);
    assert.equal(res.statusCode, 200);
    assert.equal(Array.isArray(res.body), true);
  }
  assert.equal(calls.length, 3);
  for (const { sql, values } of calls) {
    assert.doesNotMatch(sql, /LIKE/);
    assert.deepEqual(values, [
      "EMAIL",
      "PASSWORD_RESET",
      "KUMOSOFT",
      "ACCOUNT_CREATION",
    ]);
  }
});

test("invalid request searches are rejected before querying credentials", async (t) => {
  const { calls, get } = setup(t);
  for (const term of ["a".repeat(201), ["one", "two"], { value: "term" }, 123])
    await assert.rejects(get(term), { status: 400 });
  assert.equal(calls.length, 0);
});
