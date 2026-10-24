import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { config } from "../config/env.js";
import { adminRouter } from "../routes/admin.routes.js";
import { REQUEST_PERMISSION_KEYS } from "../../shared/request-permissions.mjs";
import { ensureRequestReviewSchema } from "../services/request-review.service.js";

after(() => pool.end());
const tokenA = "a".repeat(64),
  tokenB = "b".repeat(64),
  tokenC = "c".repeat(64);

async function setup(t) {
  let now = Date.now();
  const actors = new Map(
    [1, 2].map((id) => [
      id,
      {
        id,
        username: `admin${id}@example.test`,
        full_name: `Admin ${id}`,
        is_active: 1,
        role_name: "Request Staff",
        request_permissions: [...REQUEST_PERMISSION_KEYS],
      },
    ]),
  );
  const rows = new Map([
    [
      1,
      {
        id: 1,
        student_id: 7,
        credential_type: "EMAIL",
        request_kind: "PASSWORD_RESET",
        status: "PENDING",
      },
    ],
    [
      2,
      {
        id: 2,
        student_id: 8,
        credential_type: "KUMOSOFT",
        request_kind: "ACCOUNT_CREATION",
        status: "PENDING",
      },
    ],
    [
      3,
      {
        id: 3,
        student_id: 9,
        credential_type: "VOUCHER",
        request_kind: "VOUCHER_REQUEST",
        status: "PENDING",
      },
    ],
    [
      4,
      {
        id: 4,
        student_id: 10,
        credential_type: "EMAIL",
        request_kind: "PASSWORD_RESET",
        status: "COMPLETED",
      },
    ],
  ]);
  const reviews = new Map(),
    mutexes = new Map(),
    writes = [];
  const lock = async (id) => {
    const previous = mutexes.get(id) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    mutexes.set(id, current);
    await previous;
    return release;
  };
  t.mock.method(pool, "getConnection", async () => {
    let unlock, id, row, review;
    return {
      beginTransaction: async () => {},
      release() {},
      async rollback() {
        unlock?.();
        unlock = null;
      },
      async commit() {
        if (row) rows.set(id, row);
        if (review) reviews.set(id, review);
        else reviews.delete(id);
        unlock?.();
        unlock = null;
      },
      async execute(sql, values) {
        if (
          sql.startsWith("SELECT student_id, credential_type, request_kind") ||
          sql.startsWith("SELECT id FROM password_reset_requests")
        ) {
          assert.match(sql, /FOR UPDATE$/);
          id = Number(values[0]);
          unlock = await lock(id);
          row = structuredClone(rows.get(id));
          review = structuredClone(reviews.get(id));
          return [
            [row].filter(
              (item) =>
                item &&
                (sql.startsWith("SELECT id") || item.status === "PENDING"),
            ),
          ];
        }
        assert.ok(
          unlock,
          "Review operations must hold the pending request's row lock",
        );
        if (sql.startsWith("SELECT r.")) {
          // The parent request lock is sufficient; locking a missing review's
          // index gap would make unrelated first-time reviews contend.
          assert.doesNotMatch(sql, /FOR UPDATE/);
          return [
            review
              ? [
                  {
                    ...review,
                    is_live: Number(review.until > now),
                    reviewer_name: actors.get(review.admin_user_id).full_name,
                  },
                ]
              : [],
          ];
        }
        if (sql.startsWith("INSERT INTO credential_request_reviews")) {
          review = {
            admin_user_id: Number(values[1]),
            review_token: values[2],
            until: now + 90000,
          };
          return [{ affectedRows: 1 }];
        }
        if (sql.startsWith("DELETE FROM credential_request_reviews")) {
          if (
            values.length === 1 ||
            (review?.admin_user_id === Number(values[1]) &&
              review.review_token === values[2])
          )
            review = null;
          return [{ affectedRows: 1 }];
        }
        if (sql.startsWith("UPDATE password_reset_requests")) {
          row.status = sql.includes("REJECTED") ? "REJECTED" : "COMPLETED";
          writes.push({ sql, values });
          return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected transaction SQL: ${sql}`);
      },
    };
  });
  t.mock.method(pool, "execute", async (sql, values) => {
    if (sql.startsWith("SELECT a.id, a.username"))
      return [[actors.get(Number(values[0]))].filter(Boolean)];
    if (sql.startsWith("INSERT INTO audit_logs")) return [{ affectedRows: 1 }];
    if (sql.startsWith("DELETE FROM credential_request_reviews")) {
      assert.match(
        sql,
        /request_id=\? AND admin_user_id=\? AND review_token=\?/,
      );
      const [id, admin, token] = values;
      const unlock = await lock(id);
      const review = reviews.get(id);
      if (
        review?.admin_user_id === Number(admin) &&
        review.review_token === token
      )
        reviews.delete(id);
      unlock();
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  t.mock.method(pool, "query", async (sql, values) => {
    if (sql.includes("FROM password_reset_requests pr")) {
      assert.match(sql, /LEFT JOIN credential_request_reviews review/);
      assert.match(sql, /review.expires_at>NOW\(\)/);
      return [
        [...rows.values()]
          .filter((row) =>
            values.some(
              (value, i) =>
                i % 2 === 0 &&
                value === row.credential_type &&
                values[i + 1] === row.request_kind,
            ),
          )
          .map((row) => {
            const review = reviews.get(row.id);
            const live = row.status === "PENDING" && review?.until > now;
            return {
              ...row,
              reviewing_by_name: live
                ? actors.get(review.admin_user_id).full_name
                : null,
              reviewing_until: live ? new Date(review.until) : null,
            };
          }),
      ];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);
  app.use((error, req, res, next) =>
    res.status(error.status || 500).json({ message: error.message }),
  );
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const send = async (
    actor,
    id,
    action = "review",
    token = tokenA,
    extra = {},
  ) => {
    const auth = actor
      ? jwt.sign({ sub: actor, role: "Super Admin" }, config().accessSecret, {
          expiresIn: "5m",
        })
      : null;
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/admin/password-reset-requests${id === null ? "" : `/${id}/${action}`}`,
      {
        method:
          id === null
            ? "GET"
            : ["complete", "reject"].includes(action)
              ? "PATCH"
              : "POST",
        headers: {
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          "Content-Type": "application/json",
        },
        ...(id === null
          ? {}
          : { body: JSON.stringify({ reviewToken: token, ...extra }) }),
      },
    );
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
    };
  };
  return {
    send,
    actors,
    reviews,
    rows,
    writes,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("simultaneous reviews allow one administrator and expose only reviewer metadata", async (t) => {
  const { send, reviews } = await setup(t);
  const results = await Promise.all([send(1, 1), send(2, 1, "review", tokenB)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = reviews.get(1).admin_user_id;
  assert.equal(results[winner - 1].body.leaseMs, 90000);
  const list = await send(2, null);
  assert.equal(
    list.body.find((row) => row.id === 1).reviewing_by_name,
    `Admin ${winner}`,
  );
  assert.doesNotMatch(
    JSON.stringify(list.body),
    new RegExp(`${tokenA}|${tokenB}`),
  );
});

test("review ownership belongs to the administrator and tab token together", async (t) => {
  const { send, reviews } = await setup(t);
  assert.equal((await send(1, 1)).status, 200);
  assert.equal(
    (await send(1, 1)).status,
    200,
    "repeating the same acquisition is idempotent",
  );
  assert.equal(
    (await send(1, 1, "review", tokenB)).status,
    409,
    "another tab is blocked",
  );
  assert.equal(
    (await send(2, 1, "review/renew", tokenA)).status,
    409,
    "a copied token cannot change its owner",
  );
  assert.equal((await send(2, 1, "review/release", tokenA)).status, 204);
  assert.equal((await send(1, 1, "review/release", tokenB)).status, 204);
  assert.equal(reviews.get(1).review_token, tokenA);
});

test("different requests can be reviewed at the same time", async (t) => {
  const { send, reviews } = await setup(t);
  const results = await Promise.all([send(1, 1), send(2, 2, "review", tokenB)]);
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 200],
  );
  await send(1, 1, "review/release");
  assert.equal(reviews.has(1), false);
  assert.equal(reviews.get(2).admin_user_id, 2);
});

test("closing during a heartbeat cannot recreate the released review", async (t) => {
  const { send, reviews } = await setup(t);
  await send(1, 1);
  const [released, renewed] = await Promise.all([
    send(1, 1, "review/release"),
    send(1, 1, "review/renew"),
  ]);
  assert.equal(released.status, 204);
  assert.ok([200, 409].includes(renewed.status));
  assert.equal(reviews.has(1), false);
});

test("closing releases a review immediately and delayed cleanup cannot unlock a newer tab", async (t) => {
  const { send, reviews } = await setup(t);
  await send(1, 1);
  await send(1, 1, "review/release");
  assert.equal(reviews.has(1), false);
  assert.equal((await send(2, 1, "review", tokenB)).status, 200);
  await send(1, 1, "review/release");
  assert.equal(reviews.get(1).review_token, tokenB);
  await send(2, 1, "review/release", tokenB);
  await send(1, 1, "review", tokenC);
  await send(1, 1, "review/release", tokenA);
  assert.equal(reviews.get(1).review_token, tokenC);
});

test("an expired review recovers and the stale reviewer cannot renew or complete it", async (t) => {
  const { send, advance, reviews, writes } = await setup(t);
  await send(1, 1);
  advance(90001);
  assert.equal((await send(1, 1, "review/renew")).status, 409);
  assert.equal((await send(2, 1, "review", tokenB)).status, 200);
  assert.equal((await send(1, 1, "complete")).status, 409);
  assert.equal(writes.length, 0);
  await send(1, 1, "review/release");
  assert.equal(reviews.get(1).admin_user_id, 2);
});

test("heartbeats retain an open review beyond its original expiry", async (t) => {
  const { send, advance } = await setup(t);
  await send(1, 1);
  advance(20000);
  assert.equal((await send(1, 1, "review/renew")).status, 200);
  advance(70001);
  assert.equal((await send(2, 1, "review", tokenB)).status, 409);
  advance(20000);
  assert.equal((await send(2, 1, "review", tokenB)).status, 200);
});

test("completion requires a live owned review and clears it atomically", async (t) => {
  const { send, reviews, rows, writes } = await setup(t);
  assert.equal(
    (await send(1, 1, "complete", undefined, { reviewToken: undefined }))
      .status,
    409,
  );
  assert.equal((await send(1, 1, "complete")).status, 409);
  await send(1, 1);
  assert.equal((await send(2, 1, "complete", tokenB)).status, 409);
  assert.equal(writes.length, 0);
  assert.equal((await send(1, 1, "complete")).status, 200);
  assert.equal(rows.get(1).status, "COMPLETED");
  assert.equal(reviews.has(1), false);
  assert.equal((await send(2, 1, "review", tokenB)).status, 404);
});

test("voucher rejection cannot bypass the review owner", async (t) => {
  const { send, rows, reviews, writes } = await setup(t);
  await send(1, 3);
  assert.equal((await send(2, 3, "reject", tokenB)).status, 409);
  assert.equal(writes.length, 0);
  assert.equal((await send(1, 3, "reject")).status, 200);
  assert.equal(rows.get(3).status, "REJECTED");
  assert.equal(reviews.has(3), false);
});

test("failed completion validation retains the owner's review", async (t) => {
  const { send, rows, reviews } = await setup(t);
  await send(1, 1);
  assert.equal(
    (
      await send(1, 1, "complete", tokenA, {
        replacePassword: true,
        password: "",
      })
    ).status,
    400,
  );
  assert.equal(rows.get(1).status, "PENDING");
  assert.equal(reviews.get(1).review_token, tokenA);
});

test("request permissions apply to acquiring and renewing but owners can still release after revocation", async (t) => {
  const { send, actors, reviews } = await setup(t);
  actors.get(1).request_permissions = ["EMAIL:PASSWORD_RESET"];
  assert.equal((await send(1, 2)).status, 403);
  assert.equal((await send(1, 1)).status, 200);
  actors.get(1).request_permissions = [];
  assert.equal((await send(1, 1, "review/renew")).status, 403);
  assert.equal((await send(1, 1, "review/release")).status, 204);
  assert.equal(reviews.size, 0);
});

test("resolved requests, malformed identities, and unauthenticated callers cannot acquire reviews", async (t) => {
  const { send, reviews } = await setup(t);
  assert.equal((await send(1, 4)).status, 404);
  assert.equal((await send(1, 0)).status, 400);
  assert.equal((await send(1, 1, "review", "bad-token")).status, 409);
  for (const action of ["review", "review/renew", "review/release"])
    assert.equal((await send(null, 1, action)).status, 401);
  assert.equal(reviews.size, 0);
});

test("review schema setup is additive and repeatable", async () => {
  const sql = [];
  const executor = {
    query: async (statement) => {
      sql.push(statement);
    },
  };
  await ensureRequestReviewSchema(executor);
  await ensureRequestReviewSchema(executor);
  assert.equal(sql[0], sql[1]);
  assert.match(sql[0], /CREATE TABLE IF NOT EXISTS credential_request_reviews/);
  assert.doesNotMatch(sql[0], /DROP|TRUNCATE/);
});
