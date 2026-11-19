/** Manpower Supply docs store a non-null `manpowerDetails` object; General docs keep it null. */

export function isManpowerPath(pathname: string = typeof window !== "undefined" ? window.location.pathname : ""): boolean {
  return pathname.split("?")[0].startsWith("/manpower/");
}

export function isManpowerDocument(doc: { manpowerDetails?: unknown } | null | undefined): boolean {
  const md = doc?.manpowerDetails;
  return md != null && typeof md === "object";
}

/** Keep General and Manpower Supply transaction lists isolated. */
export function filterDocsByManpowerScope<T extends { manpowerDetails?: unknown }>(
  docs: T[] | null | undefined,
  manpowerScope: boolean,
): T[] {
  const all = docs ?? [];
  return all.filter((d) => isManpowerDocument(d) === manpowerScope);
}

/** Ensure create/update payload belongs to the correct module. */
export function applyManpowerScopeToPayload<T extends Record<string, unknown>>(
  payload: T,
  isManpower: boolean,
): T {
  if (isManpower) {
    const existing =
      payload.manpowerDetails && typeof payload.manpowerDetails === "object"
        ? (payload.manpowerDetails as Record<string, unknown>)
        : {};
    return { ...payload, manpowerDetails: { ...existing } };
  }
  return { ...payload, manpowerDetails: null };
}
