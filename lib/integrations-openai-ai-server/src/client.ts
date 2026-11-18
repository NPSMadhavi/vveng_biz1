import OpenAI from "openai";

function resolveApiKey() {
  // Veda gateway is NOT OpenAI-compatible — do not use VEDA_API_KEY here.
  return (
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  );
}

function resolveBaseUrl() {
  // Veda gateway uses POST /chat, not /v1/chat/completions.
  return (
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1"
  );
}

let _client: OpenAI | null = null;
let _boundKey = "";
let _boundBase = "";

function getClient(): OpenAI {
  const apiKey = resolveApiKey();
  const baseURL = resolveBaseUrl();
  if (!apiKey) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_API_KEY (or OPENAI_API_KEY) must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }
  if (!_client || _boundKey !== apiKey || _boundBase !== baseURL) {
    _client = new OpenAI({ apiKey, baseURL });
    _boundKey = apiKey;
    _boundBase = baseURL;
  }
  return _client;
}

/** Lazy OpenAI client — reads env at call time so .env loaded after process start still works. */
export const openai = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

let _assistant: OpenAI | null = null;
let _assistantKey = "";
let _assistantBase = "";

export type AssistantChat = {
  client: OpenAI;
  model: string;
  /** True when chat is sent to the Ubuntu Qwen gateway instead of OpenAI. */
  gateway: boolean;
};

/**
 * BizOne assistant chat. When VEDA_GATEWAY_URL is set, calls the Qwen
 * gateway with VEDA_API_KEY (OpenAI-compatible /v1). Voice stays on OpenAI.
 */
export function getAssistantChat(): AssistantChat {
  const gateway = (process.env.VEDA_GATEWAY_URL || "").trim().replace(/\/$/, "");
  if (gateway) {
    const apiKey = (process.env.VEDA_API_KEY || "").trim();
    if (!apiKey) {
      throw new Error("VEDA_API_KEY is not set");
    }
    const baseURL = /\/v1$/i.test(gateway) ? gateway : `${gateway}/v1`;
    if (!_assistant || _assistantKey !== apiKey || _assistantBase !== baseURL) {
      _assistant = new OpenAI({
        apiKey,
        baseURL,
        defaultHeaders: { "X-API-Key": apiKey },
      });
      _assistantKey = apiKey;
      _assistantBase = baseURL;
    }
    const model = (process.env.VEDA_MODEL || "").trim() || "qwen";
    return { client: _assistant, model, gateway: true };
  }
  return { client: getClient(), model: "gpt-4o", gateway: false };
}
