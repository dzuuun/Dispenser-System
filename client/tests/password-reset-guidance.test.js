import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PASSWORD_RESET_FOLLOW_UP,
  NEW_PASSWORD_RESET_FOLLOW_UP,
  passwordResetGuidance,
} from "../src/password-reset-guidance.js";

test("hidden and revealed passwords give the same follow-up on either side of two characters", () => {
  for (const password of [
    null,
    "",
    "-",
    "a",
    "ab",
    "abc",
    "long-password",
    "éñ",
    "éñ中",
    "😀a",
    "😀ab",
  ]) {
    const hasPassword = Boolean(password);
    const checkForNewPassword = hasPassword && Array.from(password).length < 2;
    const credential = { hasPassword, checkForNewPassword };
    const expected = {
      hasDefaultPassword: hasPassword,
      checkForNewPassword,
      followUp:
        hasPassword && !checkForNewPassword
          ? DEFAULT_PASSWORD_RESET_FOLLOW_UP
          : NEW_PASSWORD_RESET_FOLLOW_UP,
    };
    assert.deepEqual(passwordResetGuidance(credential), expected);
    assert.deepEqual(
      passwordResetGuidance({ ...credential, password }),
      expected,
    );
    // Hide All removes plaintext but preserves the summary's follow-up flag.
    assert.deepEqual(passwordResetGuidance({ ...credential }), expected);
  }
});

test("a revealed password determines the follow-up even if summary metadata is stale", () => {
  assert.equal(
    passwordResetGuidance({
      hasPassword: true,
      checkForNewPassword: true,
      password: "replacement",
    }).followUp,
    DEFAULT_PASSWORD_RESET_FOLLOW_UP,
  );
  assert.equal(
    passwordResetGuidance({
      hasPassword: true,
      checkForNewPassword: false,
      password: "-",
    }).followUp,
    NEW_PASSWORD_RESET_FOLLOW_UP,
  );
});

test("the single dash placeholder always instructs students to return for a new password", () => {
  for (const credential of [
    { hasPassword: true, checkForNewPassword: true },
    { hasPassword: true, checkForNewPassword: false, password: "-" },
  ]) {
    const guidance = passwordResetGuidance(credential);
    assert.equal(guidance.checkForNewPassword, true);
    assert.equal(guidance.followUp, NEW_PASSWORD_RESET_FOLLOW_UP);
    assert.doesNotMatch(guidance.followUp, /sign in/i);
  }
});
