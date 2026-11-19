import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load key=value pairs from .env into process.env.
 *
 * Critical for Plesk/Passenger:
 * - Never overwrite host-supplied PORT / NODE_ENV / PASSENGER_* once set.
 * - Placeholder detection applies only to integration secrets (API keys / SMTP),
 *   never to short values like PORT ("8080") or NODE_ENV ("production").
 */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

/** Explicit host-owned keys (Passenger / Plesk / OS). */
const HOST_OWNED_KEYS = new Set([
  "PORT",
  "NODE_ENV",
  "HOST",
  "PASSENGER_APP_ENV",
  "PASSENGER_SPAWN_WORK_DIR",
  "PASSENGER_CONNECT_PASSWORD",
  "PASSENGER_INSTANCE_REGISTRY_DIR",
]);

function isHostOwnedKey(key: string): boolean {
  if (HOST_OWNED_KEYS.has(key)) return true;
  // Any Passenger-injected variable
  if (key.startsWith("PASSENGER_")) return true;
  return false;
}

/** Local secrets that may safely replace empty/placeholder process env values. */
const PREFER_FILE_KEYS = new Set([
  "VEDA_GATEWAY_URL",
  "VEDA_API_KEY",
  "VEDA_LLM_MODEL",
  "VEDA_MODEL",
  "VEDA_STT_ENGINE",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "SMTP_SECURE",
  "SUPERADMIN_USERNAME",
  "SUPERADMIN_EMAIL",
  "SUPERADMIN_PASSWORD",
]);

function looksLikeSecretPlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  const k = v.trim().toLowerCase();
  // Intentionally NO length check — short values like PORT must never match.
  return (
    k.includes("your-openai") ||
    k.includes("your-api-key") ||
    k === "sk-xxx" ||
    k.endsWith("-here")
  );
}

export function loadLocalEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cwd = process.cwd();
  const candidates = [
    path.join(here, ".env"), // next to bundled entry (dist/) or src/
    path.join(cwd, "src", ".env"), // artifacts/api-server/src/.env (dev.mjs cwd)
    path.join(cwd, ".env"), // app root / api-server/.env when cwd is api-server
    path.resolve(here, "..", ".env"), // artifacts/api-server/.env when running from dist/ or src/
    path.resolve(here, "..", "src", ".env"),
    path.resolve(here, "..", "..", "..", ".env"), // repo / Application Root (module-relative)
    // Also try absolute-ish fallbacks relative to known layout
    path.resolve(cwd, "artifacts", "api-server", ".env"),
    path.resolve(cwd, "artifacts", "api-server", "src", ".env"),
  ];

  const merged: Record<string, string> = {};
  for (const file of candidates) {
    Object.assign(merged, parseEnvFile(file));
  }

  for (const [key, value] of Object.entries(merged)) {
    const current = process.env[key];

    // Passenger/Plesk own these. If already set (even to a short port number), keep them.
    if (isHostOwnedKey(key)) {
      if (current !== undefined && current !== "") continue;
      // Only fill when completely unset; never install an empty PORT from .env.
      if (value !== "") {
        process.env[key] = value;
      }
      continue;
    }

    if (PREFER_FILE_KEYS.has(key)) {
      const fileWins =
        key === "VEDA_GATEWAY_URL" ||
        key === "VEDA_API_KEY" ||
        key === "VEDA_LLM_MODEL" ||
        key === "VEDA_MODEL" ||
        key === "VEDA_STT_ENGINE";
      if (
        fileWins ||
        current === undefined ||
        current === "" ||
        looksLikeSecretPlaceholder(current)
      ) {
        if (value !== "") process.env[key] = value;
      }
      continue;
    }

    // Default: fill gaps only — never override a non-empty process env value.
    // (SESSION_SECRET, DATABASE_URL, CORS_ORIGINS, etc. can come from .env when unset.)
    if (current === undefined || current === "") {
      process.env[key] = value;
    }
  }

  // artifacts/api-server/.env is the file colleagues edit (gateway, key, model).
  // It wins over the repo-root .env. Root fills any key the server file omits.
  // Also accept colleague aliases (BIZONE_*, QWEN_MODEL) and common typos.
  const apiServerEnv = path.resolve(here, "..", ".env");
  const repoRootEnv = path.resolve(here, "..", "..", "..", ".env");
  const apiParsed = parseEnvFile(apiServerEnv);
  const rootParsed = parseEnvFile(repoRootEnv);
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = apiParsed[key] || rootParsed[key] || process.env[key];
      if (value && String(value).trim()) return String(value).trim();
    }
    return "";
  };
  const gateway = pick(
    "VEDA_GATEWAY_URL",
    "BIZONE_GATEWAY_URL",
    "BIZONE_GATEWAY_URL_GATEWAY_URL",
    "GATEWAY_URL",
  );
  const apiKey = pick("VEDA_API_KEY", "BIZONE_API_KEY", "GATEWAY_API_KEY");
  const model = pick("VEDA_LLM_MODEL", "VEDA_MODEL", "QWEN_MODEL", "VEDA_LLM_MODE", "LLM_MODEL");
  const sttEngine = pick("VEDA_STT_ENGINE", "STT_ENGINE", "WHISPER_ENGINE");
  if (gateway) process.env.VEDA_GATEWAY_URL = gateway.replace(/\/$/, "");
  if (apiKey) process.env.VEDA_API_KEY = apiKey;
  if (model) {
    process.env.VEDA_LLM_MODEL = model;
    process.env.VEDA_MODEL = model;
  }
  if (sttEngine) process.env.VEDA_STT_ENGINE = sttEngine;
}

loadLocalEnv();
