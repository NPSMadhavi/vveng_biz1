import { buildApprovalSheet } from "./timesheet-approval";
import type { Timesheet } from "./timesheet-store";

export type AckStatus = "pending" | "confirmed" | "rejected";

export async function createTimesheetAck(sheet: Timesheet): Promise<{ token: string; url: string; approveUrl: string; status: AckStatus } | null> {
  const approval = buildApprovalSheet(sheet);
  try {
    const res = await fetch("/api/timesheet-ack", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        side: sheet.side,
        partyName: approval.partyName,
        partyEmail: sheet.partyEmail,
        periodLabel: approval.periodLabel,
        rows: approval.rows,
        totalNormal: approval.totalNormal,
        totalOt: approval.totalOt,
        timesheetIds: approval.ids.length ? approval.ids : [sheet.id],
        reuseToken: sheet.approvalToken || undefined,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function syncTimesheetAckStatus(ids: string[]): Promise<Record<string, { status: AckStatus; token: string }>> {
  if (!ids.length) return {};
  try {
    const res = await fetch(`/api/timesheet-ack/status?ids=${encodeURIComponent(ids.join(","))}`, { credentials: "include" });
    if (!res.ok) return {};
    const data = await res.json();
    return (data?.byId || {}) as Record<string, { status: AckStatus; token: string }>;
  } catch {
    return {};
  }
}

export async function confirmTimesheetAck(sheet: Timesheet, status: "confirmed" | "rejected" = "confirmed"): Promise<boolean> {
  const approval = buildApprovalSheet(sheet);
  try {
    const res = await fetch("/api/timesheet-ack/confirm", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timesheetIds: approval.ids.length ? approval.ids : [sheet.id],
        status,
        createIfMissing: true,
        side: sheet.side,
        partyName: approval.partyName,
        partyEmail: sheet.partyEmail,
        periodLabel: approval.periodLabel,
        rows: approval.rows,
        totalNormal: approval.totalNormal,
        totalOt: approval.totalOt,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function localStatusFromAck(status: AckStatus): "approved" | "rejected" | "submitted" {
  if (status === "confirmed") return "approved";
  if (status === "rejected") return "rejected";
  return "submitted";
}
