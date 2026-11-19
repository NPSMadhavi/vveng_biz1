import type { DeploymentSide } from "./deployment-store";

export type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected";

export type Timesheet = {
  id: string;
  companyId: number | null;
  side: DeploymentSide;
  timesheetNo: string;
  deploymentId: string;
  deploymentNo: string;
  employeeId: string;
  employeeLabel: string;
  partyId: string;
  partyName: string;
  partyEmail: string;
  workLocation: string;
  workDate: string;
  timeIn: string;
  timeOut: string;
  breakHours: string;
  normalHours: string;
  overtimeHours: string;
  dayType: string;
  remarks: string;
  submittedBy: string;
  status: TimesheetStatus;
  sentTo: string;
  approvalToken?: string;
  billingRate?: string;
  otBillingRate?: string;
};

const KEY = "bizone.manpower.timesheets";

export function loadTimesheets(): Timesheet[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTimesheet(record: Timesheet) {
  const all = loadTimesheets().filter((row) => row.id !== record.id);
  all.unshift(record);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function updateTimesheet(id: string, patch: Partial<Timesheet>) {
  const next = loadTimesheets().map((row) => (row.id === id ? { ...row, ...patch } : row));
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function removeTimesheet(id: string) {
  localStorage.setItem(KEY, JSON.stringify(loadTimesheets().filter((row) => row.id !== id)));
}
