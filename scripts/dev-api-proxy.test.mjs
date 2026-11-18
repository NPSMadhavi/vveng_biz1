import assert from "node:assert/strict";
import http from "node:http";
import { devApiProxy } from "./dev-api-proxy.mjs";

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, method, path, headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {} },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("error", reject);
    if (body) req.end(body);
    else req.end();
  });
}

const proxyPortHolder = { api: 1 };
const proxy = await listen((req, res) => {
  devApiProxy(proxyPortHolder.api)(req, res, () => {
    res.writeHead(404);
    res.end("not api");
  });
});
const proxyPort = proxy.address().port;

let gets = 0;
const api = await listen((req, res) => {
  if (req.url === "/api/maintenance") {
    gets += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ isEnabled: false }));
    return;
  }
  if (req.url === "/api/bad") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "bad request" }));
    return;
  }
  res.writeHead(404);
  res.end();
});
proxyPortHolder.api = api.address().port;

const ok = await request(proxyPort, "GET", "/api/maintenance");
assert.equal(ok.status, 200);
assert.match(ok.body, /isEnabled/);

const bad = await request(proxyPort, "GET", "/api/bad");
assert.equal(bad.status, 400);
assert.match(bad.body, /bad request/);

const restartPort = api.address().port;
await new Promise((resolve, reject) => {
  api.close((err) => (err ? reject(err) : resolve()));
});
proxyPortHolder.api = restartPort;

const postStarted = Date.now();
const post = await request(proxyPort, "POST", "/api/invoices", "{}");
const postMs = Date.now() - postStarted;
assert.equal(post.status, 503);
assert.match(post.body, /temporary/);
assert.ok(postMs < 1500, `POST was retried (${postMs}ms)`);

const getStarted = Date.now();
const recoveredPromise = request(proxyPort, "GET", "/api/maintenance");
await new Promise((r) => setTimeout(r, 700));
const late = await new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ recovered: true, url: req.url }));
  });
  server.listen(restartPort, "127.0.0.1", () => resolve(server));
});
const recovered = await recoveredPromise;
assert.equal(recovered.status, 200);
assert.match(recovered.body, /recovered/);
assert.ok(Date.now() - getStarted >= 600, "GET should have waited for the API");

await new Promise((resolve) => late.close(() => resolve()));
await new Promise((resolve) => proxy.close(() => resolve()));
console.log(`dev-api-proxy tests passed (upstream GETs seen: ${gets})`);
