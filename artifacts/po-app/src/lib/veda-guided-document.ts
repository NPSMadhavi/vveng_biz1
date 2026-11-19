import { dispatchVedaFormFill } from "@/hooks/useVedaFormFill";
import { sanitizeGuidedAnswer } from "@/lib/veda-optimistic-fill";
import { isAffirmativeOrSave } from "@/lib/veda-guided-sales-order";

export type GuidedDocParty = "customer" | "vendor";

export type GuidedDocField = {
  key: string;
  ask: string;
  optional?: boolean;
  transform?: (answer: string) => unknown;
  when?: (filled: Record<string, unknown>) => boolean;
};

function parseLooseDate(answer: string): string | null {
  const t = answer.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const iso = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
  }
  return null;
}

function mapCurrency(a: string): string {
  const upper = a.toUpperCase();
  const t = upper.replace(/[^A-Z]/g, "");
  if (/\bSGD\b|SINGAPORE|S\$/.test(upper) || t === "SGD") return "SGD";
  if (/\bUSD\b|DOLLAR|US\$/.test(upper) || t === "USD") return "USD";
  if (/\bEUR\b|EURO/.test(upper) || t === "EUR") return "EUR";
  if (/\bGBP\b|POUND/.test(upper) || t === "GBP") return "GBP";
  if (/\bMYR\b|RINGGIT/.test(upper) || t === "MYR") return "MYR";
  if (/\bINR\b|RUPEE/.test(upper) || t === "INR") return "INR";
  if (/^[A-Z]{3}$/.test(t)) return t;
  return a.trim().toUpperCase().slice(0, 3) || "SGD";
}

function asHtmlDescription(a: string): string {
  const t = a.trim();
  if (!t) return "";
  if (/^<p[\s>]/i.test(t)) return t;
  return `<p>${t}</p>`;
}

function customerFields(): GuidedDocField[] {
  return [
    { key: "customerName", ask: "Customer name?" },
    {
      key: "customerAddress",
      ask: "Address?",
      optional: true,
      when: (f) => !String(f.customerAddress || "").trim(),
    },
    {
      key: "currency",
      ask: "Currency?",
      transform: mapCurrency,
    },
    { key: "paymentTerms", ask: "Payment terms?" },
    {
      key: "deliveryDate",
      ask: "Delivery date?",
      optional: true,
      transform: (a) => parseLooseDate(a) ?? a,
    },
    {
      key: "items.0.description",
      ask: "Item description?",
      transform: asHtmlDescription,
    },
    {
      key: "items.0.qty",
      ask: "Quantity?",
      transform: (a) => {
        const n = parseFloat(a.replace(/[^\d.]/g, ""));
        return Number.isFinite(n) && n > 0 ? n : 1;
      },
    },
    {
      key: "items.0.unitPrice",
      ask: "Unit price?",
      transform: (a) => {
        const n = parseFloat(a.replace(/[^\d.]/g, ""));
        return Number.isFinite(n) ? n : 0;
      },
    },
    { key: "notes", ask: "Notes?", optional: true },
  ];
}

function vendorFields(): GuidedDocField[] {
  return [
    { key: "vendorName", ask: "Vendor name?" },
    {
      key: "vendorAddress",
      ask: "Address?",
      optional: true,
      when: (f) => !String(f.vendorAddress || "").trim(),
    },
    {
      key: "currency",
      ask: "Currency?",
      transform: mapCurrency,
    },
    { key: "paymentTerms", ask: "Payment terms?" },
    {
      key: "deliveryDate",
      ask: "Delivery date?",
      optional: true,
      transform: (a) => parseLooseDate(a) ?? a,
    },
    {
      key: "items.0.description",
      ask: "Item description?",
      transform: asHtmlDescription,
    },
    {
      key: "items.0.qty",
      ask: "Quantity?",
      transform: (a) => {
        const n = parseFloat(a.replace(/[^\d.]/g, ""));
        return Number.isFinite(n) && n > 0 ? n : 1;
      },
    },
    {
      key: "items.0.unitPrice",
      ask: "Unit price?",
      transform: (a) => {
        const n = parseFloat(a.replace(/[^\d.]/g, ""));
        return Number.isFinite(n) ? n : 0;
      },
    },
    { key: "notes", ask: "Notes?", optional: true },
  ];
}

export type GuidedDocumentSession = {
  path: string;
  party: GuidedDocParty;
  fields: GuidedDocField[];
  index: number;
  filled: Record<string, unknown>;
  awaitingSave: boolean;
};

type ContactHit = {
  name: string;
  address?: string | null;
  contact?: string | null;
  email?: string | null;
  deliveryAddress?: string | null;
};

function scoreNameMatch(spoken: string, candidate: string): number {
  const a = spoken.toLowerCase().trim();
  const b = candidate.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.includes(a) || a.includes(b)) return 80;
  const at = a.split(/\s+/).filter(Boolean);
  const bt = new Set(b.split(/\s+/).filter(Boolean));
  return at.filter((t) => bt.has(t)).length * 20;
}

async function resolveParty(type: GuidedDocParty, spoken: string): Promise<ContactHit | null> {
  try {
    const res = await fetch(`/api/contacts?type=${type}`, { credentials: "include" });
    if (!res.ok) return null;
    const list = (await res.json()) as ContactHit[];
    if (!Array.isArray(list) || list.length === 0) return null;
    let best: ContactHit | null = null;
    let bestScore = 0;
    for (const c of list) {
      const s = scoreNameMatch(spoken, c.name || "");
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return bestScore >= 40 ? best : null;
  } catch {
    return null;
  }
}

/** True for document create forms that should walk fields locally (not employees). */
export function isGuidedDocumentCreatePath(path: string | undefined | null): boolean {
  if (!path) return false;
  if (/\/employees\//.test(path)) return false;
  if (/\/sales-orders\//.test(path)) return false; // dedicated SO session
  return (
    /\/(quotations|invoices|purchase-quotations|purchase-orders|delivery-orders|proforma-invoices|vendor-invoices|credit-notes|debit-notes|grn)\/new(?:\?|$)/.test(
      path,
    ) || /\/(projects|licenses|assets|stock)\/new(?:\?|$)/.test(path)
  );
}

export function guidedDocPartyFromPath(path: string): GuidedDocParty {
  if (/\/(purchase-quotations|purchase-orders|vendor-invoices|grn)\//.test(path)) return "vendor";
  return "customer";
}

export function createGuidedDocumentSession(path: string): GuidedDocumentSession {
  const party = guidedDocPartyFromPath(path);
  const today = new Date().toISOString().slice(0, 10);
  const defaults: Record<string, unknown> = {
    issueDate: today,
    currency: "SGD",
    paymentTerms: "30 Days Net",
    tax: 9,
  };
  dispatchVedaFormFill(defaults);
  return {
    path,
    party,
    fields: party === "vendor" ? vendorFields() : customerFields(),
    index: 0,
    filled: { ...defaults },
    awaitingSave: false,
  };
}

export function currentDocField(session: GuidedDocumentSession): GuidedDocField | null {
  if (session.awaitingSave) return null;
  while (session.index < session.fields.length) {
    const field = session.fields[session.index];
    if (field.when && !field.when(session.filled)) {
      session.index += 1;
      continue;
    }
    return field;
  }
  return null;
}

export function currentDocQuestion(session: GuidedDocumentSession): string {
  if (session.awaitingSave) return "Shall I save this?";
  return currentDocField(session)?.ask || "Shall I save this?";
}

function isSkipAnswer(answer: string): boolean {
  return /^(skip|none|no|later|n\/a|na|pass|same)[.!]?$/i.test(answer.trim());
}

/**
 * Apply a spoken/typed answer to the current document field and ask the next one.
 * Ends with "Shall I save this?" — caller saves only when done:true.
 */
export async function applyGuidedDocumentAnswer(
  session: GuidedDocumentSession,
  rawAnswer: string,
): Promise<{ ok: boolean; nextAsk: string; filled?: Record<string, unknown>; done?: boolean }> {
  const answer = sanitizeGuidedAnswer(rawAnswer);
  if (!answer) return { ok: false, nextAsk: currentDocQuestion(session) };

  if (session.awaitingSave) {
    if (isAffirmativeOrSave(answer)) {
      return { ok: true, nextAsk: "Saving.", done: true };
    }
    if (/^(no|nope|not yet|wait|cancel|don'?t save)[.!]?$/i.test(answer)) {
      session.awaitingSave = false;
      return { ok: true, nextAsk: "Okay. Say save when ready." };
    }
    return { ok: false, nextAsk: "Shall I save this?" };
  }

  if (isAffirmativeOrSave(answer) && /\b(?:save|submit)\b/i.test(answer)) {
    return { ok: true, nextAsk: "Saving.", done: true };
  }

  const field = currentDocField(session);
  if (!field) {
    session.awaitingSave = true;
    return { ok: true, nextAsk: "Shall I save this?" };
  }

  if (field.optional && isSkipAnswer(answer)) {
    session.index += 1;
    const next = currentDocField(session);
    if (!next) {
      session.awaitingSave = true;
      return { ok: true, nextAsk: "Shall I save this?" };
    }
    return { ok: true, nextAsk: next.ask };
  }

  let value: unknown = field.transform ? field.transform(answer) : answer;
  if (value == null || value === "") {
    return { ok: false, nextAsk: field.ask };
  }

  const patch: Record<string, unknown> = { [field.key]: value };

  if (field.key === "customerName" || field.key === "vendorName") {
    const hit = await resolveParty(session.party, String(value));
    if (hit) {
      if (session.party === "customer") {
        patch.customerName = hit.name;
        if (hit.address) patch.customerAddress = hit.address;
        if (hit.contact) patch.customerContact = hit.contact;
        if (hit.email) patch.customerContactEmail = hit.email;
        if (hit.deliveryAddress) patch.deliveryAddress = hit.deliveryAddress;
      } else {
        patch.vendorName = hit.name;
        if (hit.address) patch.vendorAddress = hit.address;
        if (hit.contact) patch.vendorContact = hit.contact;
        if (hit.email) patch.vendorContactEmail = hit.email;
      }
      window.dispatchEvent(
        new CustomEvent("veda:select-contact", {
          detail: { type: session.party, contact: hit },
        }),
      );
    }
  }

  dispatchVedaFormFill(patch);
  Object.assign(session.filled, patch);
  session.index += 1;

  const next = currentDocField(session);
  if (!next) {
    session.awaitingSave = true;
    return { ok: true, nextAsk: "Shall I save this?", filled: patch };
  }
  return { ok: true, nextAsk: next.ask, filled: patch };
}
