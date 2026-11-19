import fs from "node:fs";
import net from "node:net";

// Simulate load-env alias resolution from api-server .env
const text = fs.readFileSync(new URL("./.env", import.meta.url), "utf8");
const env = {};
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const base = (env.VEDA_GATEWAY_URL || env.BIZONE_GATEWAY_URL || env.BIZONE_GATEWAY_URL_GATEWAY_URL || "").replace(/\/$/, "");
const key = env.VEDA_API_KEY || env.BIZONE_API_KEY || "";
const model = env.VEDA_LLM_MODEL || env.QWEN_MODEL || "";
console.log(JSON.stringify({ base, model, keySet: Boolean(key) }));

const u = new URL(base);
const open = await new Promise((resolve) => {
  const s = net.connect({ host: u.hostname, port: Number(u.port || 80), timeout: 4000 });
  s.on("connect", () => { s.end(); resolve(true); });
  s.on("timeout", () => { s.destroy(); resolve(false); });
  s.on("error", () => resolve(false));
});
console.log(JSON.stringify({ open }));
if (!open) process.exit(0);

const headers = { "Content-Type": "application/json", "X-API-Key": key, Authorization: `Bearer ${key}` };
async function hit(path, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(base + path, { ...init, headers: init?.headers || headers, signal: ctrl.signal });
    const buf = Buffer.from(await res.arrayBuffer());
    const asText = buf.toString("utf8").slice(0, 220);
    return { path, status: res.status, bytes: buf.length, body: asText };
  } catch (e) {
    return { path, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

const health = await hit("/health");
const models = await hit("/api/v1/models");
const chat = await hit("/api/v1/chat", {
  method: "POST",
  body: JSON.stringify({ message: "Reply with the single word pong.", system_prompt: "One word only." }),
});
const voices = await hit("/api/v1/tts/voices");
const tts = await hit("/api/v1/tts/synthesize", {
  method: "POST",
  body: JSON.stringify({ text: "Vendor name?", voice: "en/en_US-lessac-medium" }),
});
console.log(JSON.stringify({ health, models, chat, voices: { status: voices.status, error: voices.error, body: String(voices.body || "").slice(0, 120) }, tts: { status: tts.status, bytes: tts.bytes, error: tts.error } }, null, 2));
