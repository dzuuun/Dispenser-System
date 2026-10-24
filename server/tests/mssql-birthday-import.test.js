import assert from "node:assert/strict";
import { after, test } from "node:test";
import sql from "mssql";
import { pool } from "../config/db.js";
import {
  previewMssqlStudentImport,
  importMssqlStudents,
} from "../controllers/mssql-student-import.controller.js";
import {
  reviewStudentRows,
  upsertStudentRows,
} from "../controllers/bulk-import.controller.js";

after(() => pool.end());

function setup(t, options = {}) {
  for (const [key, value] of Object.entries({
    MSSQL_SERVER: "test-server",
    MSSQL_DATABASE: "test-registrar",
    MSSQL_USER: "test-user",
    MSSQL_PASSWORD: "test-password",
    MSSQL_STUDENT_VIEW: "dbo.TestStudents",
  })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  const source = [
    {
      SchoolID: "OLD",
      FirstName: "Updated",
      MiddleName: "",
      LastName: "Student",
      BirthDate: options.oldBirthday ?? "1999-01-01",
      CourseCode: "BSIT",
    },
    {
      SchoolID: "NEW",
      FirstName: "New",
      MiddleName: "",
      LastName: "Student",
      BirthDate: options.newBirthday ?? new Date("2006-04-05T00:00:00Z"),
      CourseCode: "BSIT",
    },
  ];
  let stored = [
    {
      id: 1,
      student_id: "OLD",
      kumosoft_id: null,
      birth_date: "2005-02-03",
      first_name: "Corrected",
      academic_period_id: 6,
      is_active: 1,
    },
  ];
  if (options.absent)
    stored.push({
      id: 2,
      student_id: "ABSENT",
      birth_date: "2000-01-01",
      is_active: 1,
    });
  let staged, importIds;
  const calls = [],
    inputs = [];
  let connections = 0;
  t.mock.method(sql, "ConnectionPool", function () {
    connections++;
    return {
      async connect() {
        return this;
      },
      request() {
        return this;
      },
      input(name, type, value) {
        inputs.push({ name, value });
        return this;
      },
      async query(query) {
        assert.match(query.trim(), /^SELECT/);
        return { recordset: structuredClone(source) };
      },
      async close() {},
    };
  });
  const run = async (query, values = []) => {
    calls.push({ sql: query, values });
    const students = staged || stored;
    if (query.includes("FROM academic_periods"))
      return [
        [{ id: 7, school_year: "2026-2027", semester: "First semester" }],
      ];
    if (query.includes("FROM courses WHERE is_active=1"))
      return [[{ id: 1, code: "BSIT" }]];
    if (query.startsWith("SELECT id, student_id, kumosoft_id"))
      return [structuredClone(students)];
    if (query.startsWith("SELECT student_id FROM students WHERE is_active=1"))
      return [
        students
          .filter((s) => s.is_active)
          .map((s) => ({ student_id: s.student_id })),
      ];
    if (query.startsWith("INSERT INTO students")) {
      assert.ok(staged, "Student writes must be inside the import transaction");
      if (options.lateCorrection)
        staged.find((s) => s.student_id === "OLD").birth_date =
          options.lateCorrection;
      const updatesBirthdays = query
        .split("ON DUPLICATE KEY UPDATE")[1]
        .includes("birth_date=VALUES(birth_date)");
      for (let start = 0; start < values.length; start += 8) {
        const [
          studentId,
          kumosoftId,
          firstName,
          middleName,
          lastName,
          birthDate,
          courseId,
          academicPeriodId,
        ] = values.slice(start, start + 8);
        let student = staged.find((s) => s.student_id === studentId);
        const isNew = !student;
        if (isNew) {
          student = { id: staged.length + 1, student_id: studentId };
          staged.push(student);
        }
        Object.assign(student, {
          first_name: firstName,
          middle_name: middleName,
          last_name: lastName,
          course_id: courseId,
          academic_period_id: academicPeriodId,
          is_active: 1,
        });
        if (kumosoftId || isNew) student.kumosoft_id = kumosoftId;
        if (isNew || updatesBirthdays) student.birth_date = birthDate;
      }
      return [{ affectedRows: values.length / 8 }];
    }
    if (
      /^INSERT INTO (satp|schoology|kumosoft|institutional_email)_accounts/.test(
        query,
      ) ||
      query.startsWith("DELETE p FROM pending_account_imports")
    )
      return [{ affectedRows: 0 }];
    if (query.includes("CREATE TEMPORARY TABLE import_mssql_student_ids")) {
      importIds = new Set();
      return [[]];
    }
    if (query.includes("INSERT IGNORE INTO import_mssql_student_ids")) {
      values.forEach((id) => importIds.add(id));
      return [{ affectedRows: values.length }];
    }
    if (query.startsWith("UPDATE students s")) {
      if (options.failSync) throw new Error("Sync failed");
      let affectedRows = 0;
      for (const student of staged)
        if (student.is_active && !importIds.has(student.student_id)) {
          student.is_active = 0;
          affectedRows++;
        }
      return [{ affectedRows }];
    }
    if (query.includes("DROP TEMPORARY TABLE")) {
      importIds = undefined;
      return [[]];
    }
    throw new Error(query);
  };
  const connection = {
    query: run,
    execute: run,
    async beginTransaction() {
      staged = structuredClone(stored);
    },
    async commit() {
      stored = staged;
      staged = undefined;
    },
    async rollback() {
      staged = undefined;
    },
    release() {
      assert.equal(staged, undefined);
    },
  };
  t.mock.method(pool, "query", run);
  t.mock.method(pool, "execute", run);
  t.mock.method(pool, "getConnection", async () => connection);
  const invoke = async (handler, { query = {}, body = {} } = {}) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(value) {
        this.body = value;
        return this;
      },
    };
    await handler({ query, body }, res, (error) => {
      throw error;
    });
    return res;
  };
  return {
    source,
    calls,
    inputs,
    connection,
    invoke,
    get students() {
      return stored;
    },
    get connections() {
      return connections;
    },
  };
}

test("MSSQL preview and import default to preserving corrected birthdays while updating enrollment", async (t) => {
  const store = setup(t);
  const preview = await store.invoke(previewMssqlStudentImport);
  assert.equal(preview.body.updateExistingBirthdays, false);
  assert.deepEqual(
    [preview.body.new, preview.body.update, preview.body.invalid],
    [1, 1, 0],
  );
  assert.ok(
    store.calls.every(({ sql }) => sql.startsWith("SELECT")),
    "Preview must be read-only",
  );
  const result = await store.invoke(importMssqlStudents);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.updateExistingBirthdays, false);
  const old = store.students.find((s) => s.student_id === "OLD");
  assert.equal(old.birth_date, "2005-02-03");
  assert.equal(old.first_name, "Updated");
  assert.equal(old.academic_period_id, 7);
  assert.equal(
    store.students.find((s) => s.student_id === "NEW").birth_date,
    "2006-04-05",
  );
  assert.deepEqual(store.inputs.slice(0, 2), [
    { name: "schoolYear", value: "2026-2027" },
    { name: "semester", value: 1 },
  ]);
});

test("enabling birthday updates uses source birthdays in preview and import", async (t) => {
  const store = setup(t);
  const preview = await store.invoke(previewMssqlStudentImport, {
    query: { updateExistingBirthdays: "true" },
  });
  assert.equal(preview.body.updateExistingBirthdays, true);
  const result = await store.invoke(importMssqlStudents, {
    body: { updateExistingBirthdays: true },
  });
  assert.equal(result.body.updateExistingBirthdays, true);
  assert.equal(
    store.students.find((s) => s.student_id === "OLD").birth_date,
    "1999-01-01",
  );
});

for (const oldBirthday of ["", "bad-date"]) {
  test(`preservation ignores an existing student's unusable MSSQL birthday: ${JSON.stringify(oldBirthday)}`, async (t) => {
    const store = setup(t, { oldBirthday });
    const preview = await store.invoke(previewMssqlStudentImport, {
      query: {
        updateExistingBirthdays: "false",
        category: "update",
        offset: "0",
      },
    });
    assert.equal(preview.body.updateExistingBirthdays, false);
    assert.equal(preview.body.invalid, 0);
    assert.equal(preview.body.page.records[0].schoolId, "OLD");
    await store.invoke(importMssqlStudents, {
      body: { updateExistingBirthdays: false },
    });
    assert.equal(
      store.students.find((s) => s.student_id === "OLD").birth_date,
      "2005-02-03",
    );
  });
}

test("new students still require a source birthday when updates are off", async (t) => {
  const store = setup(t, { newBirthday: "" });
  const result = await store.invoke(importMssqlStudents);
  assert.equal(result.body.updated, 1);
  assert.equal(result.body.invalid, 1);
  assert.equal(store.students.length, 1);
  assert.equal(store.students[0].birth_date, "2005-02-03");
});

test("an invalid existing source birthday is rejected when birthday updates are enabled", async (t) => {
  const store = setup(t, { oldBirthday: "bad-date" });
  const result = await store.invoke(importMssqlStudents, {
    body: { updateExistingBirthdays: true },
  });
  assert.equal(result.body.invalid, 1);
  assert.equal(result.body.updated, 0);
  assert.equal(
    store.students.find((s) => s.student_id === "OLD").birth_date,
    "2005-02-03",
  );
});

test("preservation omits the birthday update in SQL so a correction made after validation survives", async (t) => {
  const store = setup(t, { lateCorrection: "2004-09-09" });
  await store.invoke(importMssqlStudents);
  assert.equal(
    store.students.find((s) => s.student_id === "OLD").birth_date,
    "2004-09-09",
  );
  const insert = store.calls.find(({ sql }) =>
    sql.startsWith("INSERT INTO students"),
  );
  assert.doesNotMatch(
    insert.sql.split("ON DUPLICATE KEY UPDATE")[1],
    /birth_date=/,
  );
});

test("repeated imports preserve birthdays corrected after the first synchronization", async (t) => {
  const store = setup(t);
  await store.invoke(importMssqlStudents);
  store.students.find((s) => s.student_id === "NEW").birth_date = "2007-05-06";
  await store.invoke(importMssqlStudents);
  assert.equal(
    store.students.find((s) => s.student_id === "NEW").birth_date,
    "2007-05-06",
  );
});

test("student synchronization still requires deactivation confirmation and preserves birthdays", async (t) => {
  const store = setup(t, { absent: true });
  const result = await store.invoke(importMssqlStudents);
  assert.equal(result.statusCode, 409);
  assert.equal(
    store.students.find((s) => s.student_id === "ABSENT").is_active,
    1,
  );
  const confirmed = await store.invoke(importMssqlStudents, {
    body: { confirmDeactivation: true, updateExistingBirthdays: false },
  });
  assert.equal(confirmed.body.deactivated, 1);
  assert.equal(
    store.students.find((s) => s.student_id === "OLD").birth_date,
    "2005-02-03",
  );
});

test("a synchronization failure rolls back birthday and enrollment updates together", async (t) => {
  const store = setup(t, { failSync: true }),
    before = structuredClone(store.students);
  await assert.rejects(
    store.invoke(importMssqlStudents, {
      body: { updateExistingBirthdays: true },
    }),
    /Sync failed/,
  );
  assert.deepEqual(store.students, before);
});

test("invalid toggle values fail before connecting to either database", async (t) => {
  const store = setup(t);
  for (const value of [null, "true", "false", 0, 1, [], {}])
    await assert.rejects(
      store.invoke(importMssqlStudents, {
        body: { updateExistingBirthdays: value },
      }),
      { status: 400 },
    );
  for (const value of ["1", "FALSE", ["true", "false"], {}])
    await assert.rejects(
      store.invoke(previewMssqlStudentImport, {
        query: { updateExistingBirthdays: value },
      }),
      { status: 400 },
    );
  assert.equal(store.connections, 0);
  assert.equal(store.calls.length, 0);
});

test("regular student imports retain the default birthday-update behavior", async (t) => {
  const store = setup(t);
  await store.connection.beginTransaction();
  const review = await reviewStudentRows(
    store.source.map((row) => ({
      ...row,
      BirthDate: row.BirthDate instanceof Date ? "2006-04-05" : row.BirthDate,
    })),
    store.connection,
  );
  await upsertStudentRows(review.items, store.connection);
  await store.connection.commit();
  assert.equal(
    store.students.find((s) => s.student_id === "OLD").birth_date,
    "1999-01-01",
  );
});

function matchExistingStudents(store) {
  Object.assign(store.students[0], {
    first_name: "Updated",
    middle_name: null,
    last_name: "Student",
    course_id: 1,
    academic_period_id: 7,
    is_active: 1,
  });
  store.students.push({
    id: 3,
    student_id: "NEW",
    kumosoft_id: null,
    first_name: "New",
    middle_name: "",
    last_name: "Student",
    birth_date: "2006-04-05",
    course_id: "1",
    academic_period_id: "7",
    is_active: "1",
  });
}

test("identical existing students are unchanged in preview and import and receive no student-row writes", async (t) => {
  const store = setup(t);
  matchExistingStudents(store);
  store.students[0].kumosoft_id = "LOCAL-KUMOSOFT-ID";
  const before = structuredClone(store.students);
  const preview = await store.invoke(previewMssqlStudentImport);
  assert.deepEqual(
    [
      preview.body.total,
      preview.body.new,
      preview.body.update,
      preview.body.unchanged,
      preview.body.invalid,
    ],
    [2, 0, 0, 2, 0],
  );
  assert.equal(preview.body.groups.update.records.length, 0);
  assert.equal(preview.body.groups.unchanged.records.length, 2);
  assert.match(preview.body.groups.unchanged.records[0].message, /No changes/);
  const imported = await store.invoke(importMssqlStudents);
  assert.equal(imported.statusCode, 200);
  assert.deepEqual(
    [imported.body.inserted, imported.body.updated, imported.body.unchanged],
    [0, 0, 2],
  );
  assert.match(imported.body.message, /0 updated, 2 unchanged/);
  assert.deepEqual(store.students, before);
  assert.ok(
    !store.calls.some(({ sql }) => sql.startsWith("INSERT INTO students")),
  );
});

for (const change of [
  { first_name: "Different" },
  { middle_name: "Different" },
  { last_name: "Different" },
  { course_id: 2 },
  { academic_period_id: 6 },
  { is_active: 0 },
])
  test(`a real profile or enrollment difference counts as an update: ${JSON.stringify(change)}`, async (t) => {
    const store = setup(t);
    matchExistingStudents(store);
    Object.assign(store.students[0], change);
    const preview = await store.invoke(previewMssqlStudentImport);
    assert.deepEqual([preview.body.update, preview.body.unchanged], [1, 1]);
    assert.equal(preview.body.groups.update.records[0].schoolId, "OLD");
    const imported = await store.invoke(importMssqlStudents);
    assert.deepEqual([imported.body.updated, imported.body.unchanged], [1, 1]);
    const insert = store.calls.find(({ sql }) =>
      sql.startsWith("INSERT INTO students"),
    );
    assert.equal(
      insert.values.length,
      8,
      "Only the changed student is upserted",
    );
    assert.equal(insert.values[0], "OLD");
  });

test("birthday-only differences count as updates only when birthday updates are enabled", async (t) => {
  const store = setup(t);
  matchExistingStudents(store);
  const preserved = await store.invoke(previewMssqlStudentImport);
  assert.deepEqual([preserved.body.update, preserved.body.unchanged], [0, 2]);
  const replacing = await store.invoke(previewMssqlStudentImport, {
    query: { updateExistingBirthdays: "true" },
  });
  assert.deepEqual([replacing.body.update, replacing.body.unchanged], [1, 1]);
  await store.invoke(importMssqlStudents, {
    body: { updateExistingBirthdays: true },
  });
  const repeated = await store.invoke(previewMssqlStudentImport, {
    query: { updateExistingBirthdays: "true" },
  });
  assert.deepEqual([repeated.body.update, repeated.body.unchanged], [0, 2]);
});

test("unchanged rows paginate separately without changing counts or limiting synchronization", async (t) => {
  const store = setup(t);
  matchExistingStudents(store);
  for (let index = 0; index < 261; index++) {
    store.source.push({
      SchoolID: `SAME${index}`,
      FirstName: "Same",
      MiddleName: "",
      LastName: "Student",
      BirthDate: "2000-01-01",
      CourseCode: "BSIT",
    });
    store.students.push({
      id: index + 4,
      student_id: `SAME${index}`,
      first_name: "Same",
      middle_name: null,
      last_name: "Student",
      birth_date: "2000-01-01",
      course_id: 1,
      academic_period_id: 7,
      is_active: 1,
    });
  }
  const preview = await store.invoke(previewMssqlStudentImport);
  assert.equal(preview.body.unchanged, 263);
  assert.equal(preview.body.update, 0);
  assert.equal(preview.body.groups.unchanged.records.length, 250);
  assert.equal(preview.body.groups.unchanged.hasMore, true);
  const more = await store.invoke(previewMssqlStudentImport, {
    query: { category: "unchanged", offset: "250" },
  });
  assert.equal(more.body.unchanged, 263);
  assert.equal(more.body.page.records.length, 13);
  assert.equal(more.body.page.records[0].schoolId, "SAME248");
  assert.equal(more.body.page.hasMore, false);
  const imported = await store.invoke(importMssqlStudents);
  assert.equal(imported.body.unchanged, 263);
  assert.ok(
    store.students.every((s) => Number(s.is_active) === 1),
    "Unchanged source students must remain enrolled",
  );
  assert.ok(
    !store.calls.some(({ sql }) => sql.startsWith("INSERT INTO students")),
  );
});

test("synchronization can still deactivate absent students when all source students are unchanged", async (t) => {
  const store = setup(t, { absent: true });
  matchExistingStudents(store);
  const preview = await store.invoke(previewMssqlStudentImport);
  assert.deepEqual(
    [
      preview.body.new,
      preview.body.update,
      preview.body.unchanged,
      preview.body.deactivate,
    ],
    [0, 0, 2, 1],
  );
  assert.equal((await store.invoke(importMssqlStudents)).statusCode, 409);
  const imported = await store.invoke(importMssqlStudents, {
    body: { confirmDeactivation: true },
  });
  assert.equal(imported.statusCode, 200);
  assert.deepEqual(
    [imported.body.updated, imported.body.unchanged, imported.body.deactivated],
    [0, 2, 1],
  );
  assert.equal(
    store.students.find((s) => s.student_id === "ABSENT").is_active,
    0,
  );
  assert.equal(store.students.find((s) => s.student_id === "OLD").is_active, 1);
});
