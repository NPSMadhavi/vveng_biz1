import fs from "node:fs";

const text = fs.readFileSync(new URL("./.env", import.meta.url), "utf8");
const env = {};
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const base = (env.VEDA_GATEWAY_URL || "").replace(/\/$/, "");
const key = env.VEDA_API_KEY || "";
const model = env.VEDA_LLM_MODEL || "qwen3.5:9b";
const headers = {
  "Content-Type": "application/json",
  "X-API-Key": key,
  Authorization: `Bearer ${key}`,
};

async function post(path, body, timeoutMs = 180000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(base + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    return {
      path,
      status: res.status,
      ms: Date.now() - start,
      body: raw.slice(0, 300),
    };
  } catch (e) {
    return {
      path,
      ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(t);
  }
}

const cases = [
  ["/api/v1/chat", { message: "Reply with exactly: pong" }],
  ["/api/v1/chat", { message: "Reply with exactly: pong", model }],
  [
    "/api/v1/chat",
    {
      message: "Reply with exactly: pong",
      system_prompt: "One word only.",
      model,
    },
  ],
  [
    "/v1/chat/completions",
    {
      model,
      messages: [{ role: "user", content: "Reply with exactly: pong" }],
      max_tokens: 16,
    },
  ],
  [
    "/api/chat",
    {
      model,
      messages: [{ role: "user", content: "Reply with exactly: pong" }],
      stream: false,
    },
  ],
];

for (const [path, body] of cases) {
  console.log(JSON.stringify(await post(path, body)));
}

// STT endpoint existence (empty should 4xx, not network fail)
{
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from([0, 0, 0])]), "x.webm");
    const res = await fetch(base + "/api/v1/stt/transcribe", {
      method: "POST",
      headers: { "X-API-Key": key, Authorization: `Bearer ${key}` },
      body: form,
      signal: ctrl.signal,
    });
    const raw = await res.text();
    console.log(
      JSON.stringify({
        path: "/api/v1/stt/transcribe",
        status: res.status,
        body: raw.slice(0, 200),
      }),
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        path: "/api/v1/stt/transcribe",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
  } finally {
    clearTimeout(t);
  }
}
