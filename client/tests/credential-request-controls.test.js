import assert from "node:assert/strict";
import { test } from "node:test";
import {
  credentialRequestOptions,
  voucherRequestsEnabled,
} from "../../shared/credential-request-controls.mjs";

test("voucher requests default to enabled and respect the independent switch", () => {
  assert.equal(voucherRequestsEnabled(), true);
  assert.equal(voucherRequestsEnabled({ accept_voucher_requests: 0 }), false);
  assert.equal(voucherRequestsEnabled({ accept_voucher_requests: 1 }), true);
});

test("credential request switches preserve defaults and operate independently", () => {
  for (const type of ["EMAIL", "KUMOSOFT", "SCHOOLOGY"]) {
    assert.deepEqual(credentialRequestOptions(type), {
      passwordResets: true,
      accountRequests: true,
    });
    assert.deepEqual(
      credentialRequestOptions(type, {
        accept_password_resets: 0,
        accept_account_requests: 1,
      }),
      { passwordResets: false, accountRequests: true },
    );
    assert.deepEqual(
      credentialRequestOptions(type, {
        accept_password_resets: true,
        accept_account_requests: false,
      }),
      { passwordResets: true, accountRequests: false },
    );
    assert.deepEqual(
      credentialRequestOptions(type, {
        accept_password_resets: 0,
        accept_account_requests: 0,
      }),
      { passwordResets: false, accountRequests: false },
    );
  }
});

test("SATP and non-account modules never offer credential request buttons", () => {
  for (const type of [
    "SATP",
    "VOUCHER",
    "KIOSK",
    "PASSWORD_RESET_REQUEST",
    "UNKNOWN",
  ])
    assert.deepEqual(
      credentialRequestOptions(type, {
        accept_password_resets: 1,
        accept_account_requests: 1,
      }),
      { passwordResets: false, accountRequests: false },
    );
});
