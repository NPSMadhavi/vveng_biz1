import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getUploadsRoot } from "./ensure-uploads.js";

export type TimesheetApprovalRow = { name: string; normal: number; overtime: number };

export type TimesheetApprovalRecord = {
  token: string;
  companyId: number;
  side: "customer" | "supplier";
  partyName: string;
  partyEmail: string;
  periodLabel: string;
  rows: TimesheetApprovalRow[];
  totalNormal: number;
  totalOt: number;
  timesheetIds: string[];
  status: "pending" | "confirmed" | "rejected";
  confirmedAt?: string;
  confirmedBy?: "customer" | "staff";
  createdAt: string;
  updatedAt: string;
};

type StoreFile = { records: TimesheetApprovalRecord[] };

function storePath(): string {
  return path.join(getUploadsRoot(), "timesheet-approvals.json");
}

function readStore(): StoreFile {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.records)) return parsed as StoreFile;
  } catch {}
  return { records: [] };
}

function writeStore(data: StoreFile) {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export function findApprovalByToken(token: string): TimesheetApprovalRecord | undefined {
  return readStore().records.find((row) => row.token === token);
}

export function findApprovalsByIds(companyId: number, ids: string[]): TimesheetApprovalRecord[] {
  const wanted = new Set(ids.filter(Boolean));
  if (!wanted.size) return [];
  return readStore().records.filter(
    (row) => row.companyId === companyId && row.timesheetIds.some((id) => wanted.has(id)),
  );
}

export function upsertTimesheetApproval(input: {
  companyId: number;
  side: "customer" | "supplier";
  partyName: string;
  partyEmail: string;
  periodLabel: string;
  rows: TimesheetApprovalRow[];
  totalNormal: number;
  totalOt: number;
  timesheetIds: string[];
  reuseToken?: string;
}): TimesheetApprovalRecord {
  const now = new Date().toISOString();
  const data = readStore();
  const idsKey = [...input.timesheetIds].sort().join(",");
  const existing = data.records.find((row) => {
    if (input.reuseToken && row.token === input.reuseToken) return true;
    if (row.companyId !== input.companyId) return false;
    if (row.side !== input.side) return false;
    return [...row.timesheetIds].sort().join(",") === idsKey;
  });

  if (existing) {
    existing.partyName = input.partyName;
    existing.partyEmail = input.partyEmail;
    existing.periodLabel = input.periodLabel;
    existing.rows = input.rows;
    existing.totalNormal = input.totalNormal;
    existing.totalOt = input.totalOt;
    existing.timesheetIds = input.timesheetIds;
    existing.updatedAt = now;
    if (existing.status !== "confirmed" && existing.status !== "rejected") {
      existing.status = "pending";
      existing.confirmedAt = undefined;
      existing.confirmedBy = undefined;
    }
    writeStore(data);
    return existing;
  }

  const record: TimesheetApprovalRecord = {
    token: randomUUID(),
    companyId: input.companyId,
    side: input.side,
    partyName: input.partyName,
    partyEmail: input.partyEmail,
    periodLabel: input.periodLabel,
    rows: input.rows,
    totalNormal: input.totalNormal,
    totalOt: input.totalOt,
    timesheetIds: input.timesheetIds,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  data.records.unshift(record);
  data.records = data.records.slice(0, 2000);
  writeStore(data);
  return record;
}

export function markTimesheetApproval(
  token: string,
  status: "confirmed" | "rejected",
  by: "customer" | "staff",
): TimesheetApprovalRecord | undefined {
  const data = readStore();
  const record = data.records.find((row) => row.token === token);
  if (!record) return undefined;
  if (record.status !== status) {
    record.status = status;
    record.confirmedAt = new Date().toISOString();
    record.confirmedBy = by;
    record.updatedAt = record.confirmedAt;
    writeStore(data);
  }
  return record;
}

export function markTimesheetApprovalByIds(
  companyId: number,
  ids: string[],
  status: "confirmed" | "rejected",
  by: "customer" | "staff",
): TimesheetApprovalRecord | undefined {
  const matches = findApprovalsByIds(companyId, ids);
  const record = matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!record) return undefined;
  return markTimesheetApproval(record.token, status, by);
}