/**
 * Veda AI Gateway client.
 *
 * Gateway API (Central AI Platform Gateway, same as the other apps):
 *   POST {VEDA_GATEWAY_URL}/api/v1/chat
 *     body: { message, system_prompt? } → { response }
 *     header: X-API-Key from VEDA_API_KEY
 *   GET  {VEDA_GATEWAY_URL}/api/v1/models
 * Model: VEDA_LLM_MODEL (for example qwen3.5:9b). The gateway selects that model.
 * If /api/v1/chat is missing, fall back to OpenAI /v1/chat/completions, then Ollama /api/chat.
 */

export function isVedaGatewayConfigured(): boolean {
  return Boolean((process.env.VEDA_GATEWAY_URL || "").trim());
}

function gatewayBase(): string {
  return (process.env.VEDA_GATEWAY_URL || "").trim().replace(/\/$/, "");
}

function gatewayHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = (process.env.VEDA_API_KEY || "").trim();
  if (key) {
    headers.Authorization = `Bearer ${key}`;
    headers["X-API-Key"] = key;
  }
  return headers;
}

function textFromGatewayBody(raw: string): string {
  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return raw.trim();
  }
  if (!parsed || typeof parsed === "string") return String(parsed || raw || "").trim();
  const choice = parsed?.choices?.[0];
  const text =
    (typeof choice?.message?.content === "string" && choice.message.content) ||
    (typeof choice?.text === "string" && choice.text) ||
    (typeof parsed?.message?.content === "string" && parsed.message.content) ||
    (typeof parsed?.response === "string" && parsed.response) ||
    (typeof parsed?.message === "string" && parsed.message) ||
    (typeof parsed?.content === "string" && parsed.content) ||
    (typeof parsed?.text === "string" && parsed.text) ||
    "";
  return String(text).trim();
}

/** Soft user-facing AI failure. Never exposes gateway/API details, stacks, or "ran into an issue". */
export function publicAiError(err: unknown): string {
  const key = (process.env.VEDA_API_KEY || "").trim();
  let raw = err instanceof Error ? err.message : String(err || "");
  if (key) raw = raw.split(key).join("[redacted]");
  raw = raw.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  // Log-friendly detail stays in server logs only — UI always gets a soft clarify line.
  void raw;
  return "I didn't quite get that — could you say it again?";
}

let modelLookup: Promise<string> | null = null;
let modelLookupAt = 0;

function configuredModelName(): string {
  return (process.env.VEDA_LLM_MODEL || process.env.VEDA_MODEL || "").trim();
}

/** VEDA_LLM_MODEL, otherwise VEDA_MODEL, otherwise the first Qwen model the gateway reports. */
export function ensureGatewayModel(): Promise<string> {
  const configured = configuredModelName();
  if (configured) return Promise.resolve(configured);
  if (!modelLookup || Date.now() - modelLookupAt > 30_000) {
    modelLookupAt = Date.now();
    modelLookup = discoverGatewayModel();
  }
  return modelLookup;
}

async function readJson(url: string): Promise<{ status: number; body: any } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { headers: gatewayHeaders(), signal: controller.signal });
    const raw = await res.text();
    let body: any = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverGatewayModel(): Promise<string> {
  const base = gatewayBase();
  if (!base) return "qwen";
  const root = base.replace(/\/v1$/i, "");
  const names: string[] = [];
  const platform = await readJson(`${root}/api/v1/models`);
  if (Array.isArray(platform?.body?.models)) {
    for (const row of platform.body.models) {
      const name = row?.name || row?.model || row?.id;
      if (name) names.push(String(name));
    }
  }
  const models = await readJson(`${root}/v1/models`);
  if (Array.isArray(models?.body?.data)) {
    for (const row of models.body.data) {
      if (row?.id) names.push(String(row.id));
    }
  }
  if (names.length === 0) {
    const tags = await readJson(`${base.replace(/\/v1$/i, "")}/api/tags`);
    if (Array.isArray(tags?.body?.models)) {
      for (const row of tags.body.models) {
        if (row?.name) names.push(String(row.name));
      }
    }
  }
  const chosen = names.find((name) => /qwen/i.test(name)) || names[0] || "qwen";
  if (names.length > 0 && !configuredModelName()) process.env.VEDA_LLM_MODEL = chosen;
  return chosen;
}

/** Log gateway reachability without the API key. */
export async function logGatewayStatus(log?: { info?: Function; warn?: Function }): Promise<void> {
  const base = gatewayBase();
  const hasKey = Boolean((process.env.VEDA_API_KEY || "").trim());
  if (!base) {
    log?.warn?.({}, "[ai] VEDA_GATEWAY_URL is not set; the assistant has no Qwen gateway");
    return;
  }
  const model = await ensureGatewayModel();
  const root = base.replace(/\/v1$/i, "");
  const platform = await readJson(`${root}/api/v1/models`);
  const health = !platform || platform.status === 404 ? await readJson(`${root}/health`) : null;
  const probe = platform && platform.status !== 404 ? platform : health;
  if (!probe) {
    log?.warn?.({ model }, "[ai] Qwen gateway is configured but not reachable");
    return;
  }
  if (probe.status === 401 || probe.status === 403) {
    log?.warn?.({ status: probe.status, model }, "[ai] Qwen gateway rejected the API key");
    return;
  }
  log?.info?.({ status: probe.status, model, apiKey: hasKey ? "configured" : "missing" }, "[ai] Qwen gateway reachable");
}

function clipGatewayMessage(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 20000) return trimmed;
  return trimmed.slice(trimmed.length - 20000);
}

/** Simple chat completion against the Veda gateway. Returns plain text. */
export async function vedaChat(
  message: string,
  opts?: { timeoutMs?: number; systemPrompt?: string },
): Promise<string> {
  const base = gatewayBase();
  if (!base) {
    throw new Error("VEDA_GATEWAY_URL is not configured");
  }

  const controller = new AbortController();
  // qwen3.5:9b on the Ubuntu box often needs 1–2+ minutes on a cold start.
  const timeoutMs = opts?.timeoutMs ?? 180_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const model = await ensureGatewayModel();
  const root = base.replace(/\/v1$/i, "");
  const completionsUrl = /\/v1$/i.test(base) ? `${base}/chat/completions` : `${root}/v1/chat/completions`;
  const userMessage = clipGatewayMessage(message);
  if (!userMessage) throw new Error("Veda gateway returned an empty response");
  const systemPrompt = (opts?.systemPrompt || "").trim();

  const post = (url: string, body: unknown) => fetch(url, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  try {
    // Prefer the Central AI Platform chat endpoint first (fastest on the LAN gateway).
    const platformBody: Record<string, string> = { message: userMessage, model };
    if (systemPrompt) platformBody.system_prompt = systemPrompt;
    let res = await post(`${root}/api/v1/chat`, platformBody);

    // Only fall back when the primary route is missing — avoid extra round-trips on success.
    if (res.status === 404 || res.status === 405) {
      const messages = systemPrompt
        ? [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }]
        : [{ role: "user", content: userMessage }];
      res = await post(completionsUrl, { model, messages, max_tokens: 2048, temperature: 0.2 });
    }

    if (res.status === 404 || res.status === 405) {
      res = await post(`${root}/api/chat`, {
        model,
        messages: systemPrompt
          ? [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }]
          : [{ role: "user", content: userMessage }],
        stream: false,
        options: { temperature: 0.2, num_predict: 2048 },
      });
    }

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(publicAiError(new Error(`Veda gateway ${res.status}`)));
    }

    const text = textFromGatewayBody(raw);
    if (!text.trim()) {
      throw new Error("Veda gateway returned an empty response");
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

/** Speech to text on the same gateway: POST /api/v1/stt/transcribe, field "file" (fast-whisper). */
export async function vedaTranscribe(audio: Buffer, filename = "audio.webm"): Promise<string> {
  const base = gatewayBase();
  if (!base) throw new Error("VEDA_GATEWAY_URL is not configured");
  const root = base.replace(/\/v1$/i, "");
  const engine = (process.env.VEDA_STT_ENGINE || "fast-whisper").trim();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), filename);
  if (engine) {
    form.append("engine", engine);
    form.append("model", engine);
  }
  const headers = gatewayHeaders();
  delete headers["Content-Type"];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${root}/api/v1/stt/transcribe`, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(publicAiError(new Error(`Veda gateway ${res.status}`)));
    const text = textFromGatewayBody(raw);
    if (!text.trim()) throw new Error("Veda gateway returned an empty response");
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_TTS_VOICE = "en/en_US-lessac-medium";

/** Text to speech on the same gateway: POST /api/v1/tts/synthesize → WAV bytes. */
export async function vedaSpeak(
  text: string,
  opts?: { voice?: string; timeoutMs?: number },
): Promise<{ audio: Buffer; mimeType: string; voice: string }> {
  const base = gatewayBase();
  if (!base) throw new Error("VEDA_GATEWAY_URL is not configured");
  const root = base.replace(/\/v1$/i, "");
  const voice = (opts?.voice || process.env.VEDA_TTS_VOICE || DEFAULT_TTS_VOICE).trim();
  const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 2000);
  if (!clean) throw new Error("Veda gateway returned an empty response");

  const controller = new AbortController();
  // Keep TTS short — the browser falls back if the LAN synth is slow.
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 8_000);
  try {
    const res = await fetch(`${root}/api/v1/tts/synthesize`, {
      method: "POST",
      headers: gatewayHeaders(),
      body: JSON.stringify({ text: clean, voice }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      throw new Error(publicAiError(new Error(raw || `Veda gateway ${res.status}`)));
    }
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) throw new Error("Veda gateway returned an empty response");
    const mimeType = res.headers.get("content-type") || "audio/wav";
    return { audio, mimeType, voice };
  } finally {
    clearTimeout(timer);
  }
}
