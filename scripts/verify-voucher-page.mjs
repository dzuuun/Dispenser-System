// Exercises the production build with 4,769 synthetic vouchers; no database writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const vouchers = Array.from({ length: 4769 }, (_, index) => ({
  id: index + 1,
  voucher_code: `TEST-${String(index + 1).padStart(5, "0")}`,
  is_active: 1,
  is_assigned: 0,
  is_released: 0,
  assigned_at: null,
  student_id: null,
}));
const requests = [];
const errors = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/dispenser/api/")) {
      res.setHeader("Content-Type", "application/json");
      const route = url.pathname.slice("/dispenser/api".length);
      let body = {};
      if (route === "/auth/refresh") body = { accessToken: "test-session" };
      else if (route === "/admin/academic-periods") body = [];
      else if (route === "/admin/password-reset-requests/pending-count")
        body = { count: 0 };
      else if (route === "/admin/voucher-records") {
        requests.push(Object.fromEntries(url.searchParams));
        const term = url.searchParams.get("search[value]") || "";
        const filtered = vouchers.filter((row) =>
          row.voucher_code.includes(term),
        );
        if (url.searchParams.get("direction") === "desc") filtered.reverse();
        const offset = Number(url.searchParams.get("start"));
        const limit = Number(url.searchParams.get("length"));
        body = {
          recordsTotal: vouchers.length,
          recordsFiltered: filtered.length,
          summary: {
            total: vouchers.length,
            available: vouchers.filter((row) => row.is_active).length,
            assigned: 0,
          },
          data: filtered.slice(offset, offset + limit),
        };
      } else if (/\/admin\/voucher-records\/\d+\/status/.test(route)) {
        vouchers[Number(route.split("/")[3]) - 1].is_active = 0;
        body = { message: "Voucher updated." };
      }
      res.end(JSON.stringify(body));
      return;
    }
    const asset = url.pathname.startsWith("/dispenser/assets/");
    const filename = asset
      ? path.join("client/dist/assets", path.basename(url.pathname))
      : "client/dist/index.html";
    const extensions = {
      ".js": "application/javascript",
      ".css": "text/css",
      ".woff2": "font/woff2",
      ".png": "image/png",
    };
    res.setHeader(
      "Content-Type",
      extensions[path.extname(filename)] || "text/html",
    );
    res.end(await readFile(filename));
  } catch (error) {
    res.statusCode = 500;
    res.end(error.message);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(path.join(tmpdir(), "dispenser-voucher-check-"));
const chrome = spawn(
  process.env.CHROME_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--remote-debugging-pipe",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    `--user-data-dir=${profile}`,
  ],
  { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
);
let sequence = 0;
let buffer = "";
const pending = new Map();
chrome.on("error", (error) => {
  for (const item of pending.values()) item.reject(error);
});
chrome.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString();
  let boundary;
  while ((boundary = buffer.indexOf("\0")) !== -1) {
    const message = JSON.parse(buffer.slice(0, boundary));
    buffer = buffer.slice(boundary + 1);
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
    const item = pending.get(message.id);
    if (item) {
      pending.delete(message.id);
      clearTimeout(item.timeout);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    }
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 10000);
    pending.set(id, { resolve, reject, timeout });
    chrome.stdio[3].write(
      JSON.stringify({ id, method, params, sessionId }) + "\0",
    );
  });
try {
  const { targetId } = await send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await send("Runtime.enable", {}, sessionId);
  const evaluate = async (expression) => {
    const result = await send(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      sessionId,
    );
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Condition not reached: ${expression}`);
  };
  const started = performance.now();
  await send(
    "Page.navigate",
    {
      url: `http://127.0.0.1:${server.address().port}/dispenser/admin/vouchers`,
    },
    sessionId,
  );
  await waitFor("document.querySelectorAll('.voucher-code').length === 25");
  const firstRowsMs = Math.round(performance.now() - started);
  assert.equal(
    requests.length,
    1,
    "First paint must use a single paginated request",
  );
  assert.equal(requests[0].length, "25");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.vouchers-data-table .dt-container').length",
    ),
    0,
  );
  await evaluate(
    "document.querySelector('[aria-label=\"Next page\"]').click()",
  );
  await waitFor(
    "document.querySelector('.voucher-code')?.textContent === 'TEST-00026'",
  );
  await evaluate(
    `const input = document.querySelector('[aria-label="Search vouchers or students"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'TEST-04769'); input.dispatchEvent(new Event('input', { bubbles: true }));`,
  );
  await waitFor(
    "document.querySelectorAll('.voucher-code').length === 1 && document.querySelector('.voucher-code').textContent === 'TEST-04769'",
  );
  await evaluate(
    "[...document.querySelectorAll('.row-actions button')].find(b => b.textContent === 'Deactivate').click()",
  );
  await waitFor(
    "[...document.querySelectorAll('button')].some(b => b.textContent.includes('Deactivate voucher'))",
  );
  await evaluate(
    "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Deactivate voucher')).click()",
  );
  await waitFor(
    "document.querySelector('.student-list-table tbody').textContent.includes('Inactive')",
  );
  assert.equal(vouchers[4768].is_active, 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: [
        "first page",
        "single request",
        "next page",
        "search",
        "status update refresh",
        "no browser exceptions",
      ],
      syntheticVouchers: vouchers.length,
      firstRowsMs,
    }),
  );
} finally {
  try {
    await send("Browser.close");
  } catch {
    chrome.kill();
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
