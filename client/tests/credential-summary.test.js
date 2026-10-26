import assert from "node:assert/strict";
import { test } from "node:test";
import { credentialSummaryState } from "../src/credential-summary.js";

for (const type of ["SATP", "EMAIL", "KUMOSOFT", "SCHOOLOGY"]) {
  test(`${type}: linked accounts without a password use the unavailable summary state`, () => {
    for (const password of [undefined, null, "", "   "]) {
      const hidden = {
        type,
        username: "student",
        hasPassword: false,
        unavailable: false,
      };
      const expected = { unavailable: true, requestKind: "PASSWORD_RESET" };
      assert.deepEqual(credentialSummaryState(hidden), expected);
      assert.deepEqual(
        credentialSummaryState({ ...hidden, password }),
        expected,
      );
    }
  });
}

test("missing accounts remain unavailable and use account creation requests", () => {
  assert.deepEqual(
    credentialSummaryState({ unavailable: true, hasPassword: false }),
    {
      unavailable: true,
      requestKind: "ACCOUNT_CREATION",
    },
  );
});

test("hidden passwords and single-character reset placeholders keep the existing available state", () => {
  const expected = { unavailable: false, requestKind: "PASSWORD_RESET" };
  assert.deepEqual(
    credentialSummaryState({ hasPassword: true, unavailable: false }),
    expected,
  );
  for (const password of ["-", "a", "ab", "actual-password"])
    assert.deepEqual(
      credentialSummaryState({
        password,
        hasPassword: true,
        unavailable: false,
      }),
      expected,
    );
});

test("revealed values take precedence over stale password metadata and are never mutated", () => {
  const credential = {
    username: "student",
    hasPassword: true,
    unavailable: false,
    password: "",
  };
  const original = structuredClone(credential);
  assert.equal(credentialSummaryState(credential).unavailable, true);
  assert.deepEqual(credential, original);
  assert.equal(
    credentialSummaryState({ hasPassword: false, password: "replacement" })
      .unavailable,
    false,
  );
});

test("older summaries without password metadata preserve the server's availability", () => {
  assert.equal(
    credentialSummaryState({ unavailable: false }).unavailable,
    false,
  );
  assert.equal(credentialSummaryState({ unavailable: true }).unavailable, true);
});
