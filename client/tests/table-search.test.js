import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dateSearchText,
  kioskSearchValues,
  matchesTableSearch,
} from "../src/table-search.js";

test("kiosk search matches every displayed column, including connection, usage details and dates", () => {
  const kiosk = {
    kiosk_name: "Main dispenser",
    kiosk_code: "KIOSK-001",
    location: "Library",
    is_online: 1,
    usage_status: "IN_USE",
    activity_state: "VIEWING_CREDENTIALS",
    last_seen: "2026-10-24T07:03:00.000Z",
    password: "hidden-secret",
  };
  const values = kioskSearchValues(kiosk);
  for (const term of [
    "Main dispenser",
    "Library",
    "Online",
    "In use",
    "Viewing credentials",
    new Date(kiosk.last_seen).toLocaleDateString(),
    new Date(kiosk.last_seen).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  ])
    assert.equal(matchesTableSearch(term, values), true, term);
  assert.equal(matchesTableSearch("hidden-secret", values), false);
  assert.equal(matchesTableSearch("KIOSK-001", values), false);
  assert.equal(matchesTableSearch("Offline", values), false);
});

test("kiosk search reflects idle, unknown, offline and placeholder labels exactly as displayed", () => {
  for (const state of ["IDLE", "UNKNOWN", "OFFLINE"])
    assert.equal(
      matchesTableSearch(
        state,
        kioskSearchValues({
          usage_status: state,
          is_online: state !== "OFFLINE",
        }),
      ),
      true,
    );
  const missing = kioskSearchValues({ is_online: 0 });
  assert.equal(matchesTableSearch("Unassigned", missing), true);
  assert.equal(matchesTableSearch("Never", missing), true);
  assert.equal(matchesTableSearch("Never connected", missing), true);
  assert.equal(
    matchesTableSearch(
      "Entering details",
      kioskSearchValues({
        is_online: 1,
        usage_status: "IN_USE",
        activity_state: "ENTERING_DETAILS",
      }),
    ),
    true,
  );
});

test("client-side search normalizes case, accents and whitespace without treating wildcard text as a pattern", () => {
  assert.equal(matchesTableSearch("  PENA  ", ["Pe\u00f1a"]), true);
  assert.equal(
    matchesTableSearch("viewing   credentials", ["Viewing credentials"]),
    true,
  );
  assert.equal(matchesTableSearch("%_", ["abc"]), false);
  assert.equal(matchesTableSearch("%_", ["Code%_100"]), true);
});

test("date search text includes all displayed local formats and handles missing timestamps", () => {
  const timestamp = "2026-10-24T07:03:00.000Z";
  const date = new Date(timestamp);
  const result = dateSearchText(timestamp);
  for (const text of [
    date.toLocaleString(),
    date.toLocaleDateString(),
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  ])
    assert.ok(result.includes(text));
  for (const value of [null, undefined, "", "invalid"])
    assert.equal(dateSearchText(value), "");
});
