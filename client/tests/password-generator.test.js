import assert from "node:assert/strict";
import { test } from "node:test";
import { generateRandomPassword } from "../src/password-generator.js";

test("generated passwords contain 12 letters and digits without ambiguous characters", () => {
  for (let sample = 0; sample < 1000; sample++) {
    const password = generateRandomPassword();
    assert.match(password, /^[A-Za-z0-9]{12}$/);
    assert.doesNotMatch(password, /[iIl1Oo0]/);
    assert.match(password, /[A-Za-z]/);
    assert.match(password, /[2-9]/);
  }
});
