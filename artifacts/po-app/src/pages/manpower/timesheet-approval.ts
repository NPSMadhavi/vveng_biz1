import type { Timesheet } from "./timesheet-store";
import { loadTimesheets } from "./timesheet-store";

export type ApprovalRow = { name: string; normal: number; overtime: number };

export type ApprovalSheet = {
  partyName: string;
  periodLabel: string;
  rows: ApprovalRow[];
  totalNormal: number;
  totalOt: number;
  status: "Pending" | "Approved" | "Rejected";
  ids: string[];
};

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function periodLabel(iso: string) {
  const [year, month] = monthKey(iso).split("-").map(Number);
  if (!year || !month) return "";
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const fmt = (date: Date) => date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function employeeName(label: string) {
  return label.split("–")[0]?.trim() || label || "Employee";
}

function sheetStatus(rows: Timesheet[]): ApprovalSheet["status"] {
  if (rows.length > 0 && rows.every((row) => row.status === "approved")) return "Approved";
  if (rows.length > 0 && rows.every((row) => row.status === "rejected")) return "Rejected";
  return "Pending";
}

export function buildApprovalSheet(anchor: Timesheet): ApprovalSheet {
  const month = monthKey(anchor.workDate);
  const stored = loadTimesheets();
  const storedAnchor = stored.find((row) => row.id === anchor.id);
  const current = storedAnchor ? { ...anchor, ...storedAnchor } : anchor;
  const merged = [current, ...stored.filter((row) => row.id !== current.id)];
  const related = merged.filter((row) =>
    row.side === current.side &&
    row.companyId === current.companyId &&
    row.partyId === current.partyId &&
    monthKey(row.workDate) === month &&
    row.status !== "draft",
  );
  const grouped = new Map<string, ApprovalRow>();
  related.forEach((row) => {
    const current = grouped.get(row.employeeId) ?? { name: employeeName(row.employeeLabel), normal: 0, overtime: 0 };
    current.normal += Number(row.normalHours) || 0;
    current.overtime += Number(row.overtimeHours) || 0;
    grouped.set(row.employeeId, current);
  });
  const rows = [...grouped.values()];
  return {
    partyName: current.partyName || "—",
    periodLabel: periodLabel(current.workDate),
    rows,
    totalNormal: rows.reduce((sum, row) => sum + row.normal, 0),
    totalOt: rows.reduce((sum, row) => sum + row.overtime, 0),
    status: sheetStatus(related),
    ids: related.map((row) => row.id),
  };
}

export function hoursText(value: number) {
  return String(Math.round(value * 100) / 100);
}
