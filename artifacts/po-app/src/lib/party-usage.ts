export type PartyUsage = "general" | "manpower";

export function partyUsage(row: { usageType?: string | null } | null | undefined): PartyUsage {
  return row?.usageType === "manpower" ? "manpower" : "general";
}

export function isGeneralParty(row: { usageType?: string | null } | null | undefined) {
  return partyUsage(row) === "general";
}

export function isManpowerParty(row: { usageType?: string | null } | null | undefined) {
  return partyUsage(row) === "manpower";
}
