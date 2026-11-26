import { loadTimesheets, type Timesheet, type TimesheetEntry } from "@/pages/manpower/timesheet-store";

export type ClassifiedHours = {
  normal: number;
  ot15: number;
  ot20: number;
  restDay: number;
  publicHoliday: number;
};

export type CustomerHoursRow = {
  partyId: string;
  customerName: string;
  normal: number;
  ot15: number;
  ot20: number;
  restDay: number;
  publicHoliday: number;
  totalHours: number;
  workingDays: number;
  wage: number;
  timesheetNos: string[];
  workDates: string[];
};

export type EmployeeMonthConsolidation = {
  employeeKey: string;
  employeeLabel: string;
  year: number;
  month: number;
  customers: CustomerHoursRow[];
  totals: ClassifiedHours & { totalHours: number; wage: number; workingDays: number };
  timesheetIds: string[];
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function parseMoney(value: unknown) {
  const num = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

export function classifyEntryHours(dayType: string, normalHours: string | number, overtimeHours: string | number): ClassifiedHours {
  const n = Number(normalHours) || 0;
  const ot = Number(overtimeHours) || 0;
  const total = Math.round((n + ot) * 100) / 100;
  const zero: ClassifiedHours = { normal: 0, ot15: 0, ot20: 0, restDay: 0, publicHoliday: 0 };
  const type = String(dayType || "").toLowerCase();
  if (type.includes("rest")) return { ...zero, restDay: total };
  if (type.includes("public") || type.includes("holiday")) return { ...zero, publicHoliday: total };
  if (type.includes("leave") || type.includes("absent")) return zero;
  return { ...zero, normal: n, ot15: ot };
}

function expandIsoDateRange(from?: string, to?: string): string[] {
  const startIso = String(from || "").slice(0, 10);
  const endIso = String(to || from || "").slice(0, 10);
  if (!startIso) return [];
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${(endIso && endIso >= startIso ? endIso : startIso)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [startIso];
  const out: string[] = [];
  for (let ms = start.getTime(); ms <= end.getTime() && out.length < 366; ms += 86400000) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out.length ? out : [startIso];
}

/** Scale a timesheet entry's per-day hours by its Work From–To day count (weekdays for Normal, weekends for Rest). */
export function scaleEntryHours(
  row: Pick<TimesheetEntry, "workFrom" | "workTo" | "workDate" | "dayType" | "normalHours" | "overtimeHours" | "days">
): ClassifiedHours & { days: number } {
  const dates = expandIsoDateRange(row.workFrom || row.workDate, row.workTo || row.workDate);
  let weekdays = 0;
  let weekendDays = 0;
  for (const dStr of dates) {
    const day = new Date(`${dStr}T00:00:00`).getDay();
    if (day === 0 || day === 6) weekendDays++;
    else weekdays++;
  }
  const totalDays = dates.length || 1;
  const isNormalWork = String(row.dayType || "").toLowerCase().includes("normal");
  const isRest = String(row.dayType || "").toLowerCase().includes("rest");

  let days: number;
  if (row.days != null && Number.isFinite(row.days) && row.days > 0) {
    days = row.days;
  } else if (isNormalWork && dates.length > 1) {
    days = weekdays;
  } else if (isRest && dates.length > 1 && weekendDays > 0) {
    days = weekendDays;
  } else {
    days = totalDays;
  }

  const rawN = Number(row.normalHours) || 0;
  const rawO = Number(row.overtimeHours) || 0;
  const base = classifyEntryHours(row.dayType, row.normalHours, row.overtimeHours);
  if (days > 1 && rawN + rawO > 24) {
    return { days, ...base };
  }
  return {
    days,
    normal: base.normal * days,
    ot15: base.ot15 * days,
    ot20: base.ot20 * days,
    restDay: base.restDay * days,
    publicHoliday: base.publicHoliday * days,
  };
}

function entriesOf(sheet: Timesheet): TimesheetEntry[] {
  if (Array.isArray(sheet.entries) && sheet.entries.length > 0) return sheet.entries;
  return [{
    id: `${sheet.id}-entry`,
    employeeId: sheet.employeeId,
    employeeLabel: sheet.employeeLabel,
    workLocation: sheet.workLocation,
    workDate: sheet.workDate,
    timeIn: sheet.timeIn,
    timeOut: sheet.timeOut,
    breakHours: sheet.breakHours,
    normalHours: sheet.normalHours,
    overtimeHours: sheet.overtimeHours,
    dayType: sheet.dayType,
  }];
}

function monthKey(iso: string) {
  return String(iso || "").slice(0, 7);
}

function matchesEmployee(entry: TimesheetEntry, employeeId: string | number, employeeCode?: string | null) {
  const key = String(employeeId).trim();
  const code = String(employeeCode || "").trim().toLowerCase();
  const entryKey = String(entry.employeeId || "").trim();
  const label = String(entry.employeeLabel || "").toLowerCase();
  if (key && entryKey && entryKey === key) return true;
  if (key && entryKey && Number(entryKey) === Number(key) && Number.isFinite(Number(key))) return true;
  if (code && entryKey.toLowerCase() === code) return true;
  if (code && label.includes(`(${code})`)) return true;
  return false;
}

function isApproved(status: Timesheet["status"]) {
  return status === "approved";
}

function statusRank(status: Timesheet["status"]) {
  if (status === "approved") return 3;
  if (status === "submitted") return 2;
  if (status === "draft") return 1;
  return 0;
}

function expandWorkDates(from: string, to: string): string[] {
  if (!from) return [];
  if (!to || to < from) return [from];
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

/**
 * Consolidate timesheets for one employee in one calendar month, grouped by customer.
 * Duplicate entries for the same customer + date range (e.g. draft + approved copies)
 * are collapsed so hours are not double-counted. CPF uses employee-level totals once.
 */
export function consolidateEmployeeMonthTimesheets(params: {
  employeeId: string | number;
  employeeCode?: string | null;
  employeeLabel?: string | null;
  year: number;
  month: number; // 1-12
  companyId?: number | null;
  sheets?: Timesheet[];
  /** default true — set false to include draft/submitted for payroll fill */
  requireApproved?: boolean;
}): EmployeeMonthConsolidation {
  const ym = `${params.year}-${String(params.month).padStart(2, "0")}`;
  const all = params.sheets ?? loadTimesheets();
  const matchedSheets = all.filter((sheet) => {
    if (sheet.side !== "customer") return false;
    if (params.requireApproved !== false && !isApproved(sheet.status)) return false;
    if (params.companyId != null && sheet.companyId != null && Number(sheet.companyId) !== Number(params.companyId)) {
      return false;
    }
    const entries = entriesOf(sheet).filter((entry) =>
      matchesEmployee(entry, params.employeeId, params.employeeCode)
      && monthKey(entry.workFrom || entry.workTo || entry.workDate) === ym,
    );
    return entries.length > 0;
  });

  // Per calendar day hours (Normal/OT on the form are per day).
  // Overlapping ranges (e.g. 1–25 Nov plus a single day inside that range) must not double-count.
  type DayHours = {
    sheet: Timesheet;
    partyKey: string;
    date: string;
    hours: ClassifiedHours;
    lineHours: number;
    rank: number;
    spanDays: number; // prefer wider range when ranks/hours tie
  };

  const bestByDay = new Map<string, DayHours>();

  for (const sheet of matchedSheets) {
    const partyKey = String(sheet.partyId || sheet.partyName || "unknown");
    const entries = entriesOf(sheet).filter((entry) =>
      matchesEmployee(entry, params.employeeId, params.employeeCode)
      && monthKey(entry.workFrom || entry.workTo || entry.workDate) === ym,
    );
    for (const entry of entries) {
      const from = String(entry.workFrom || entry.workDate || "").slice(0, 10);
      const to = String(entry.workTo || entry.workDate || from).slice(0, 10);
      const dates = expandWorkDates(from, to).filter((date) => monthKey(date) === ym);
      if (dates.length === 0) continue;

      // Detect already-scaled totals mistakenly stored on a multi-day entry (e.g. 200 for 25 days).
      const rawNormal = Number(entry.normalHours) || 0;
      const rawOt = Number(entry.overtimeHours) || 0;
      const span = Math.max(1, dates.length);
      const looksPreScaled = span > 1 && rawNormal + rawOt > 24;
      const perDay = looksPreScaled
        ? classifyEntryHours(
            entry.dayType,
            round2(rawNormal / span),
            round2(rawOt / span),
          )
        : classifyEntryHours(entry.dayType, entry.normalHours, entry.overtimeHours);

      const rank = statusRank(sheet.status);
      for (const date of dates) {
        const key = `${partyKey}|${String(params.employeeId).trim()}|${date}`;
        const lineHours = perDay.normal + perDay.ot15 + perDay.ot20 + perDay.restDay + perDay.publicHoliday;
        const pending: DayHours = {
          sheet,
          partyKey,
          date,
          hours: { ...perDay },
          lineHours,
          rank,
          spanDays: span,
        };
        const existing = bestByDay.get(key);
        if (!existing) {
          bestByDay.set(key, pending);
          continue;
        }
        // Prefer higher approval status; then higher daily hours; then wider original range
        if (
          rank > existing.rank
          || (rank === existing.rank && lineHours > existing.lineHours)
          || (rank === existing.rank && lineHours === existing.lineHours && span > existing.spanDays)
        ) {
          bestByDay.set(key, pending);
        }
      }
    }
  }

  const byCustomer = new Map<string, CustomerHoursRow>();
  const timesheetIds: string[] = [];

  for (const day of bestByDay.values()) {
    const { sheet, partyKey, date, hours } = day;
    if (!timesheetIds.includes(sheet.id)) timesheetIds.push(sheet.id);
    const billing = parseMoney(sheet.billingRate);
    const otRate = parseMoney(sheet.otBillingRate) || (billing > 0 ? billing * 1.5 : 0);

    let row = byCustomer.get(partyKey);
    if (!row) {
      row = {
        partyId: String(sheet.partyId || ""),
        customerName: sheet.partyName || "—",
        normal: 0,
        ot15: 0,
        ot20: 0,
        restDay: 0,
        publicHoliday: 0,
        totalHours: 0,
        workingDays: 0,
        wage: 0,
        timesheetNos: [],
        workDates: [],
      };
      byCustomer.set(partyKey, row);
    }
    if (sheet.timesheetNo && !row.timesheetNos.includes(sheet.timesheetNo)) {
      row.timesheetNos.push(sheet.timesheetNo);
    }
    if (date && !row.workDates.includes(date)) {
      row.workDates.push(date);
      row.workingDays = row.workDates.length;
    }
    row.normal = round2(row.normal + hours.normal);
    row.ot15 = round2(row.ot15 + hours.ot15);
    row.ot20 = round2(row.ot20 + hours.ot20);
    row.restDay = round2(row.restDay + hours.restDay);
    row.publicHoliday = round2(row.publicHoliday + hours.publicHoliday);
    const lineHours = hours.normal + hours.ot15 + hours.ot20 + hours.restDay + hours.publicHoliday;
    row.totalHours = round2(row.totalHours + lineHours);
    const lineWage =
      hours.normal * billing +
      hours.ot15 * otRate +
      hours.ot20 * (otRate > 0 ? otRate * (2 / 1.5) : 0) +
      (hours.restDay + hours.publicHoliday) * otRate;
    row.wage = round2(row.wage + lineWage);
  }

  const customers = [...byCustomer.values()].sort((a, b) => a.customerName.localeCompare(b.customerName));
  const totals = customers.reduce(
    (acc, row) => ({
      normal: round2(acc.normal + row.normal),
      ot15: round2(acc.ot15 + row.ot15),
      ot20: round2(acc.ot20 + row.ot20),
      restDay: round2(acc.restDay + row.restDay),
      publicHoliday: round2(acc.publicHoliday + row.publicHoliday),
      totalHours: round2(acc.totalHours + row.totalHours),
      wage: round2(acc.wage + row.wage),
      workingDays: acc.workingDays + (row.workingDays || 0),
    }),
    { normal: 0, ot15: 0, ot20: 0, restDay: 0, publicHoliday: 0, totalHours: 0, wage: 0, workingDays: 0 },
  );

  return {
    employeeKey: String(params.employeeId),
    employeeLabel: params.employeeLabel || String(params.employeeId),
    year: params.year,
    month: params.month,
    customers,
    totals,
    timesheetIds: [...new Set(timesheetIds)],
  };
}
