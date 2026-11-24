import type { DeploymentSide } from "./deployment-store";

export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected";

export type TimesheetEntry = {
  id: string;
  employeeId: string;
  employeeLabel: string;
  workLocation: string;
  workDate: string;
  workFrom?: string;
  workTo?: string;
  timeIn: string;
  timeOut: string;
  breakHours: string;
  normalHours: string;
  overtimeHours: string;
  dayType: string;
  days?: number;
};

export type Timesheet = {
  id: string;
  companyId: number | null;
  side: DeploymentSide;
  timesheetNo: string;
  project: string;
  poReference: string;
  poId: string;
  /** @deprecated kept for older localStorage rows */
  deploymentId?: string;
  /** @deprecated kept for older localStorage rows */
  deploymentNo?: string;
  employeeId: string;
  employeeLabel: string;
  partyId: string;
  partyName: string;
  partyEmail: string;
  workLocation: string;
  workDate: string;
  workFrom?: string;
  workTo?: string;
  timeIn: string;
  timeOut: string;
  breakHours: string;
  normalHours: string;
  overtimeHours: string;
  dayType: string;
  remarks: string;
  submittedBy: string;
  approvedBy?: string;
  status: TimesheetStatus;
  sentTo: string;
  approvalToken?: string;
  billingRate?: string;
  otBillingRate?: string;
  entries?: TimesheetEntry[];
};

const KEY = "bizone.manpower.timesheets";

export function normalizeTimesheet(row: any): Timesheet {
  const base = {
    ...row,
    project: row.project ?? "",
    poReference: row.poReference ?? row.deploymentNo ?? "",
    poId: row.poId ?? row.deploymentId ?? "",
  } as Timesheet;

  if (Array.isArray(row.entries) && row.entries.length > 0) {
    return {
      ...base,
      entries: row.entries.map((entry: any) => {
        const workFrom = entry.workFrom || entry.workDate || "";
        const workTo = entry.workTo || entry.workDate || workFrom;
        return {
          ...entry,
          workFrom,
          workTo,
          workDate: entry.workDate || workFrom,
        };
      }),
    };
  }

  // Legacy single-employee rows become one entry
  if (row.employeeId || row.employeeLabel) {
    const workFrom = row.workFrom || row.workDate || "";
    const workTo = row.workTo || row.workDate || workFrom;
    return {
      ...base,
      entries: [{
        id: `${row.id}-entry`,
        employeeId: row.employeeId || "",
        employeeLabel: row.employeeLabel || "",
        workLocation: row.workLocation || "",
        workDate: workFrom,
        workFrom,
        workTo,
        timeIn: row.timeIn || "08:00",
        timeOut: row.timeOut || "18:00",
        breakHours: row.breakHours || "1",
        normalHours: row.normalHours || "0",
        overtimeHours: row.overtimeHours || "0",
        dayType: row.dayType || "Normal Working Day",
      }],
    };
  }

  return { ...base, entries: [] };
}

export function loadTimesheets(): Timesheet[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTimesheet);
  } catch {
    return [];
  }
}

export function saveTimesheet(record: Timesheet) {
  const all = loadTimesheets().filter((row) => row.id !== record.id);
  all.unshift(normalizeTimesheet(record));
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function updateTimesheet(id: string, patch: Partial<Timesheet>) {
  const next = loadTimesheets().map((row) => (row.id === id ? normalizeTimesheet({ ...row, ...patch }) : row));
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function removeTimesheet(id: string) {
  localStorage.setItem(KEY, JSON.stringify(loadTimesheets().filter((row) => row.id !== id)));
}
