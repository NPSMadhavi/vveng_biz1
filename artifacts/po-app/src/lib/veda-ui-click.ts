/**
 * Veda UI click engine — click any visible control the same way a user would.
 * Prefers [data-veda-action], then button/link text / aria-label / title.
 */
export type VedaClickResult = {
  ok: boolean;
  message: string;
  matched?: string;
};

function normalizeLabel(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isVisible(el: HTMLElement): boolean {
  if (el.getAttribute("aria-hidden") === "true") return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isDisabled(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return true;
  if ((el as HTMLButtonElement).disabled) return true;
  return el.classList.contains("pointer-events-none");
}

function elementLabel(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label") || "";
  const title = el.getAttribute("title") || "";
  const veda = el.getAttribute("data-veda-action") || "";
  const text = (el.innerText || (el as HTMLInputElement).value || "").replace(/\s+/g, " ").trim();
  return text || aria || title || veda.replace(/-/g, " ");
}

function scoreMatch(want: string, got: string): number {
  if (!want || !got) return 0;
  if (got === want) return 100;
  if (got.includes(want)) return 85 - Math.min(20, Math.abs(got.length - want.length));
  if (want.includes(got) && got.length >= 4) return 70;
  const wantTokens = want.split(" ").filter(Boolean);
  const gotTokens = got.split(" ").filter(Boolean);
  if (!wantTokens.length || !gotTokens.length) return 0;
  const overlap = gotTokens.filter((t) => wantTokens.includes(t)).length;
  if (overlap === 0) return 0;
  return Math.round((overlap / Math.max(wantTokens.length, gotTokens.length)) * 55);
}

const SELECTOR = [
  "[data-veda-action]",
  "button",
  "a[href]",
  "[role='button']",
  "input[type='button']",
  "input[type='submit']",
  "[data-state][class*='button']",
].join(",");

/** Click a visible control whose label best matches `rawLabel`. */
export function clickUiControl(rawLabel: string): VedaClickResult {
  const want = normalizeLabel(rawLabel);
  if (!want) return { ok: false, message: "No button or control name was given." };

  const nodes = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
  let best: { el: HTMLElement; score: number; label: string } | null = null;

  for (const el of nodes) {
    if (!isVisible(el) || isDisabled(el)) continue;
    const action = normalizeLabel((el.getAttribute("data-veda-action") || "").replace(/-/g, " "));
    const label = elementLabel(el);
    const normalized = normalizeLabel(label);
    const score = Math.max(scoreMatch(want, normalized), scoreMatch(want, action));
    if (score <= 0) continue;
    // Prefer data-veda-action matches slightly
    const boosted = action && scoreMatch(want, action) >= 70 ? score + 5 : score;
    if (!best || boosted > best.score) best = { el, score: boosted, label: label || action };
  }

  if (!best || best.score < 40) {
    return {
      ok: false,
      message: `I could not find "${rawLabel}" on this page. Open the right screen, or say the exact button name.`,
    };
  }

  try {
    best.el.focus?.();
    best.el.click();
  } catch {
    return { ok: false, message: `Found "${best.label}" but could not click it.` };
  }

  return {
    ok: true,
    message: `Clicked ${best.label}.`,
    matched: best.label,
  };
}

/**
 * Parse "click Browse Folder" / "press Create Backup Now" style commands.
 * Returns the control label, or null if this is not a click command.
 */
const BARE_ACTION_LABELS: Array<{ re: RegExp; label: string }> = [
  { re: /^browse\s*folder$/i, label: "Browse Folder" },
  { re: /^create\s*(?:and|&)?\s*download\s*backup$/i, label: "Create & Download Backup" },
  { re: /^create\s*backup\s*now$/i, label: "Create Backup Now" },
  { re: /^configure\s*schedule$/i, label: "Configure Schedule" },
  { re: /^restore\s*from\s*backup$/i, label: "Restore From Backup" },
  { re: /^view\s*archives(?:\s*below)?$/i, label: "View Archives Below" },
  { re: /^(?:open\s+)?(?:the\s+)?pick\s+from\s+customers?(?:\s+button|\s+modal|\s+dialog)?$/i, label: "Pick from Customers" },
  { re: /^(?:open\s+)?(?:the\s+)?pick\s+from\s+vendors?(?:\s+button|\s+modal|\s+dialog)?$/i, label: "Pick from Vendors" },
  { re: /^(?:open\s+)?(?:the\s+)?pick\s+from\s+stock(?:\s+button|\s+modal|\s+dialog)?$/i, label: "Pick from stock" },
  { re: /^(?:open\s+)?(?:the\s+)?generate\s+with\s+ai(?:\s+button)?$/i, label: "Generate with AI" },
  { re: /^(?:open\s+)?(?:the\s+)?import\s+customer\s+po(?:\s+button)?$/i, label: "Import Customer PO" },
];

export function matchUiClickCommand(command: string): string | null {
  const raw = String(command || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!raw) return null;
  let clean = raw
    .replace(/^(?:veda|please|kindly|can\s+you|could\s+you|yes|yeah|sure|ok|okay)\s+/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();

  // Already handled as form actions elsewhere — leave those alone
  if (/^(?:save|submit|preview|download|close|cancel|exit)(?:\s|$)/i.test(clean)) return null;

  for (const item of BARE_ACTION_LABELS) {
    if (item.re.test(clean)) return item.label;
  }

  const patterns = [
    /^(?:click|press|tap|hit|select|choose|use)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+button)?$/i,
    /^(?:go\s+ahead\s+and\s+)?(?:click|press|tap)\s+(.+)$/i,
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (m?.[1]) {
      let label = m[1].replace(/^(?:the\s+|a\s+|an\s+)/i, "").replace(/\s+button$/i, "").trim();
      label = label.replace(/\s+(?:please|now|for\s+me)$/i, "").trim();
      if (label && label.length >= 2) {
        for (const item of BARE_ACTION_LABELS) {
          if (item.re.test(label)) return item.label;
        }
        return label;
      }
    }
  }
  return null;
}
