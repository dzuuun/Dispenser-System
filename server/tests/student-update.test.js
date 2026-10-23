import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../config/db.js";
import { getStudent, updateStudent } from "../controllers/student-admin.controller.js";
import { decryptPassword } from "../services/encryption.service.js";
import { createStudentStore, studentAccountTables } from "./helpers/student-store.js";

after(() => pool.end());
const profile = { studentId: "2026001", kumosoftId: "K-001", firstName: "Test", middleName: "Middle", lastName: "Student", birthDate: "2005-01-01", courseId: 1, isActive: true };

function setup(t) {
  const db = createStudentStore();
  t.mock.method(pool, "getConnection", async () => db.connection);
  t.mock.method(pool, "execute", db.execute);
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(body) { this.body = body; return this; } });
  const save = async (changes) => {
    const res = response();
    await updateStudent({ params: { id: "1" }, body: { ...profile, ...changes } }, res);
    return res;
  };
  const read = async () => {
    const res = response();
    await getStudent({ params: { id: "1" } }, res);
    return res.body;
  };
  return { db, save, read };
}

for (const [field, table, type] of [
  ["satpPassword", "satp_accounts", "SATP"],
  ["schoologyPassword", "schoology_accounts", "SCHOOLOGY"],
  ["kumosoftPassword", "kumosoft_accounts", "KUMOSOFT"],
  ["emailPassword", "institutional_email_accounts", "EMAIL"],
]) {
  test(`${field}: clearing removes all password material and stays empty when the profile is reopened`, async (t) => {
    const { db, save, read } = setup(t);
    const others = structuredClone(db.stored.accounts[table][2]);
    assert.equal((await save({ [field]: "" })).statusCode, 200);
    const account = db.stored.accounts[table][1];
    assert.equal(decryptPassword(account), null);
    assert.equal(account.encrypted_password, "");
    assert.equal(account.password_iv, "");
    assert.equal(account.password_auth_tag, "");
    assert.equal(account.is_active, 1);
    assert.deepEqual(db.stored.accounts[table][2], others);
    assert.equal((await read()).accounts.find((item) => item.type === type).password, null);
  });
  test(`${field}: replacement remains encrypted and exact password whitespace is preserved`, async (t) => {
    const { db, save } = setup(t);
    const password = " New test password ";
    assert.equal((await save({ [field]: password })).statusCode, 200);
    assert.equal(decryptPassword(db.stored.accounts[table][1]), password);
    assert.notEqual(db.stored.accounts[table][1].encrypted_password, password);
  });
}

test("omitted password and email fields preserve stored credentials", async (t) => {
  const { db, save } = setup(t);
  const before = studentAccountTables.map((table) => db.stored.accounts[table][1].encrypted_password);
  assert.equal((await save({ firstName: "Updated" })).statusCode, 200);
  assert.deepEqual(studentAccountTables.map((table) => db.stored.accounts[table][1].encrypted_password), before);
  assert.equal(db.stored.accounts.institutional_email_accounts[1].email_address, "student@example.edu");
});

test("clearing an email address removes only that student's linked email account", async (t) => {
  const { db, save, read } = setup(t);
  const other = structuredClone(db.stored.accounts.institutional_email_accounts[2]);
  assert.equal((await save({ emailAddress: "", emailPassword: "" })).statusCode, 200);
  assert.equal(db.stored.accounts.institutional_email_accounts[1], undefined);
  assert.deepEqual(db.stored.accounts.institutional_email_accounts[2], other);
  assert.ok(!(await read()).accounts.some((account) => account.type === "EMAIL"));
  assert.ok(db.stored.accounts.schoology_accounts[1]);
});

test("changing only the email address preserves its password; clearing only its password preserves the address", async (t) => {
  const { db, save } = setup(t);
  const before = db.stored.accounts.institutional_email_accounts[1].encrypted_password;
  assert.equal((await save({ emailAddress: "updated@example.edu" })).statusCode, 200);
  assert.equal(db.stored.accounts.institutional_email_accounts[1].encrypted_password, before);
  assert.equal((await save({ emailAddress: "updated@example.edu", emailPassword: "" })).statusCode, 200);
  assert.equal(db.stored.accounts.institutional_email_accounts[1].email_address, "updated@example.edu");
  assert.equal(decryptPassword(db.stored.accounts.institutional_email_accounts[1]), null);
});

test("clearing optional student details saves NULL and leaves required information intact", async (t) => {
  const { db, save, read } = setup(t);
  assert.equal((await save({ kumosoftId: "", middleName: "" })).statusCode, 200);
  const { student } = await read();
  assert.equal(student.kumosoft_id, null);
  assert.equal(student.middle_name, null);
  assert.equal(student.first_name, "Test");
  assert.equal(db.stored.accounts.kumosoft_accounts[1].username, "2026001");
});

test("blank or whitespace passwords do not create accounts that never existed", async (t) => {
  const { db, save } = setup(t);
  delete db.stored.accounts.satp_accounts[1];
  delete db.stored.accounts.institutional_email_accounts[1];
  assert.equal((await save({ satpPassword: "  ", emailPassword: "" })).statusCode, 200);
  assert.equal(db.stored.accounts.satp_accounts[1], undefined);
  assert.equal(db.stored.accounts.institutional_email_accounts[1], undefined);
});

test("new email accounts still require an address and password", async (t) => {
  const { db, save } = setup(t);
  delete db.stored.accounts.institutional_email_accounts[1];
  assert.equal((await save({ emailAddress: "new@example.edu", emailPassword: "" })).statusCode, 400);
  assert.equal((await save({ emailAddress: "new@example.edu", emailPassword: "new password" })).statusCode, 200);
  assert.equal(decryptPassword(db.stored.accounts.institutional_email_accounts[1]), "new password");
});

test("invalid required fields or email addresses never modify the student", async (t) => {
  const { db, save } = setup(t);
  const before = structuredClone(db.stored);
  for (const changes of [{ firstName: "" }, { lastName: "" }, { studentId: "" }, { birthDate: "" }, { emailAddress: "invalid" }])
    assert.equal((await save(changes)).statusCode, 400);
  assert.deepEqual(db.stored, before);
});

test("a later save failure rolls back cleared passwords and student details together", async (t) => {
  const { db, save } = setup(t);
  const before = structuredClone(db.stored);
  db.conflictEmail = true;
  assert.equal((await save({ middleName: "", satpPassword: "", schoologyPassword: "", emailAddress: "taken@example.edu" })).statusCode, 409);
  assert.deepEqual(db.stored, before);
});
