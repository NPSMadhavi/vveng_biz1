/**
 * Veda AI Gateway client.
 *
 * Gateway API:
 *   POST {VEDA_GATEWAY_URL}/v1/chat/completions  (Qwen, OpenAI-compatible, used by the assistant)
 *   POST {VEDA_GATEWAY_URL}/chat  body: { message: string } → { response: string }
 *
 * Auth: Authorization Bearer and X-API-Key from VEDA_API_KEY.
 * Model: VEDA_MODEL, otherwise "qwen".
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

/** User-facing AI failure. Never includes the API key, stack, or prompt. */
export function publicAiError(err: unknown): string {
  const key = (process.env.VEDA_API_KEY || "").trim();
  let raw = err instanceof Error ? err.message : String(err || "AI request failed");
  if (key) raw = raw.split(key).join("[redacted]");
  raw = raw.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  if (/401|incorrect api key|invalid api key|unauthorized/i.test(raw)) {
    return "The AI gateway rejected the API key.";
  }
  if (/model.+not found|unknown model|does not exist/i.test(raw)) {
    return "The configured Qwen model was not found on the gateway.";
  }
  if (/429|rate limit|too many requests/i.test(raw)) {
    return "The AI gateway is rate limiting requests. Try again shortly.";
  }
  if (/timeout|timed out|aborted/i.test(raw)) {
    return "The AI request timed out.";
  }
  if (/empty response/i.test(raw)) {
    return "The AI gateway returned an empty response.";
  }
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed|Connection error|Unable to connect|not configured|VEDA_API_KEY is not set|VEDA_GATEWAY_URL is not configured/i.test(raw)) {
    return "The Qwen gateway is not reachable. Start it, then try again.";
  }
  if (/^Veda gateway 5\d\d/.test(raw) || /bad gateway|service unavailable/i.test(raw)) {
    return "The AI gateway is temporarily unavailable.";
  }
  if (/^Veda gateway 404/.test(raw)) {
    return "The AI gateway has no chat endpoint at the configured URL.";
  }
  const oneLine = raw.replace(/\s+/g, " ").trim();
  if (!oneLine || oneLine.length > 180 || /at\s+\S+\s+\(|node_modules/i.test(oneLine)) {
    return "The AI request failed.";
  }
  return oneLine;
}

let modelLookup: Promise<string> | null = null;
let modelLookupAt = 0;

/** VEDA_MODEL, otherwise the first Qwen model the gateway reports, otherwise "qwen". */
export function ensureGatewayModel(): Promise<string> {
  const configured = (process.env.VEDA_MODEL || "").trim();
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
  const names: string[] = [];
  const models = await readJson(`${base.replace(/\/v1$/i, "")}/v1/models`);
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
  if (names.length > 0 && !(process.env.VEDA_MODEL || "").trim()) process.env.VEDA_MODEL = chosen;
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
  const probe = await readJson(`${base.replace(/\/v1$/i, "")}/v1/models`);
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

/** Simple chat completion against the Veda gateway. Returns plain text. */
export async function vedaChat(message: string, opts?: { timeoutMs?: number }): Promise<string> {
  const base = gatewayBase();
  if (!base) {
    throw new Error("VEDA_GATEWAY_URL is not configured");
  }

  const controller = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const model = await ensureGatewayModel();
  const root = base.replace(/\/v1$/i, "");
  const completionsUrl = /\/v1$/i.test(base) ? `${base}/chat/completions` : `${root}/v1/chat/completions`;

  const post = (url: string, body: unknown) => fetch(url, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  try {
    let res = await post(completionsUrl, {
      model,
      messages: [{ role: "user", content: message }],
      max_tokens: 4096,
    });

    if (res.status === 404 || res.status === 405) {
      res = await post(`${root}/api/chat`, {
        model,
        messages: [{ role: "user", content: message }],
        stream: false,
      });
    }

    if (res.status === 404 || res.status === 405) {
      res = await post(`${root}/chat`, { message });
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
