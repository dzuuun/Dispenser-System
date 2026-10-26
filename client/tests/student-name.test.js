import assert from "node:assert/strict";
import { test } from "node:test";
import { displayMiddleName, studentFullName } from "../../shared/student-name.mjs";

test("dash and absent middle names are omitted without leaving extra spaces", () => {
  for (const middle_name of ["-", " - ", "", "  ", null, undefined]) {
    assert.equal(displayMiddleName(middle_name), "");
    assert.equal(studentFullName({ first_name: "Juan", middle_name, last_name: "Cruz" }), "Juan Cruz");
  }
});

test("real middle names and hyphens within names remain visible", () => {
  assert.equal(studentFullName({ first_name: "Ana-Maria", middle_name: "De-la-Pena", last_name: "Santos-Cruz" }), "Ana-Maria De-la-Pena Santos-Cruz");
  assert.equal(studentFullName({ first_name: "Ana", middle_name: " D. ", last_name: "Cruz" }), "Ana D. Cruz");
});

test("kiosk and import name formats share the same display rule without changing source records", () => {
  const student = { firstName: " Juan ", middleName: "-", lastName: " Cruz " };
  assert.equal(studentFullName(student), "Juan Cruz");
  assert.equal(student.middleName, "-");
  assert.equal(studentFullName({ first_name: "Juan" }), "Juan");
  assert.equal(studentFullName({}), "");
});
