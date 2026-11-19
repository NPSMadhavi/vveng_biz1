import http from "node:http";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TRANSIENT = new Set(["ECONNREFUSED", "ECONNRESET", "EPIPE", "ENOTFOUND", "EAI_AGAIN"]);
/** Small JSON auth posts are safe to buffer + retry while the API reloads. */
const RETRYABLE_WRITE =
  /^\/api\/(auth\/login|auth\/logout|auth\/register|superadmin\/login|maintenance)\b/i;

/** Wait until the API accepts a TCP connection and returns any HTTP response. */
export function waitForApi(port, timeoutMs = 90_000) {
  const started = Date.now();
  let delay = 300;
  return new Promise((resolve) => {
    const attempt = () => {
      const req = http.get(
        { hostname: "127.0.0.1", port, path: "/api/maintenance", timeout: 2000 },
        (res) => {
          res.resume();
          resolve(true);
        },
      );
      const retry = () => {
        if (Date.now() - started >= timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(attempt, delay);
        delay = Math.min(delay * 2, 2000);
      };
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    attempt();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransient(err) {
  const code = err && (err.code || err.cause?.code);
  return TRANSIENT.has(code) || /ECONNREFUSED|socket hang up/i.test(String(err?.message || ""));
}

async function readRequestBody(req, maxBytes = 64_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw Object.assign(new Error("request body too large to buffer"), { code: "EBODYTOOLarge" });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Forward one request to the API. Safe methods and small auth POSTs are retried
 * while the API process is reloading after a rebuild.
 */
export function proxyApiRequest(req, res, port, options = {}) {
  const budgetMs = options.budgetMs ?? 45_000;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const method = String(req.method || "GET").toUpperCase();
  const safe = SAFE_METHODS.has(method);
  const path = req.originalUrl || req.url || "/";
  const retryWrite = !safe && RETRYABLE_WRITE.test(path.split("?")[0] || path);
  const started = Date.now();
  let delay = 300;
  let attempt = 0;
  let bufferedBody = null;
  let bodyReady = null;

  const sendUnavailable = () => {
    if (res.headersSent || res.writableEnded) return;
    const body = JSON.stringify({
      error: "API is restarting. Try again in a moment.",
      temporary: true,
    });
    res.writeHead(503, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    });
    res.end(body);
  };

  const ensureBody = async () => {
    if (!retryWrite) return null;
    if (bufferedBody) return bufferedBody;
    if (!bodyReady) {
      bodyReady = readRequestBody(req).then((buf) => {
        bufferedBody = buf;
        return buf;
      });
    }
    return bodyReady;
  };

  const once = async () => {
    const body = await ensureBody();
    return new Promise((resolve, reject) => {
      const headers = { ...req.headers, host: `127.0.0.1:${port}` };
      if (body) {
        headers["content-length"] = String(body.length);
        delete headers["transfer-encoding"];
      }
      const proxyReq = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method,
          path,
          headers,
          timeout: timeoutMs,
        },
        (proxyRes) => {
          if (res.headersSent || res.writableEnded) {
            proxyRes.resume();
            resolve();
            return;
          }
          const responseHeaders = { ...proxyRes.headers };
          delete responseHeaders["transfer-encoding"];
          res.writeHead(proxyRes.statusCode || 502, responseHeaders);
          proxyRes.pipe(res);
          resolve();
        },
      );
      proxyReq.on("timeout", () => {
        proxyReq.destroy(Object.assign(new Error("upstream timeout"), { code: "ETIMEDOUT" }));
      });
      proxyReq.on("error", reject);
      if (safe) {
        proxyReq.end();
      } else if (body) {
        proxyReq.end(body);
      } else {
        req.pipe(proxyReq);
      }
    });
  };

  const run = async () => {
    for (;;) {
      attempt += 1;
      try {
        await once();
        return;
      } catch (err) {
        const canRetry =
          (safe || retryWrite) &&
          isTransient(err) &&
          attempt < 12 &&
          Date.now() - started < budgetMs;
        if (!canRetry) {
          if (!res.headersSent && !res.writableEnded) sendUnavailable();
          return;
        }
        const wait = Math.min(delay, budgetMs - (Date.now() - started));
        delay = Math.min(delay * 2, 2000);
        if (wait > 0) await sleep(wait);
      }
    }
  };

  return run();
}

/** Connect/Vite middleware. Leaves non-API requests untouched. */
export function devApiProxy(port) {
  return function apiProxy(req, res, next) {
    const url = req.originalUrl || req.url || "";
    if (!url.startsWith("/api")) return next();
    proxyApiRequest(req, res, port).catch(() => {
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "API is restarting. Try again in a moment.", temporary: true }));
      }
    });
  };
}
