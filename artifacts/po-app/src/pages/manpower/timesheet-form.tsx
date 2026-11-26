import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useRoute } from "wouter";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SimpleDatePicker } from "@/components/ui/simple-date-picker";
import { TimePickerInput } from "@/components/ui/time-picker-input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TimesheetApprovalDialog } from "./timesheet-approval-dialog";
import { FormPageShell } from "@/operations-8june/components/layout/FormPageShell";
import {
  ModalCancelButton,
  ModalSaveButton,
  ModalSectionHeader,
} from "@/operations-8june/components/forms/FormModalShell";
import { formFieldGridClass } from "@/lib/form-ui";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useGetSettings, getGetSettingsQueryKey, useListSalesOrders, getListSalesOrdersQueryKey, useListPurchaseOrders, getListPurchaseOrdersQueryKey, useListQuotations, getListQuotationsQueryKey, useListPurchaseQuotations, getListPurchaseQuotationsQueryKey } from "@workspace/api-client-react";
import { todayIso, formatDisplayDate, type DeploymentSide } from "./deployment-store";
import { classifyEntryHours } from "@/operations-8june/lib/timesheet-cpf-consolidation";
import {
  loadTimesheets,
  removeTimesheet,
  saveTimesheet,
  updateTimesheet,
  type Timesheet,
  type TimesheetEntry,
} from "./timesheet-store";
import {
  createTimesheetAck,
  localStatusFromAck,
  syncTimesheetAckStatus,
} from "./timesheet-ack-api";

const DAY_TYPES = ["Normal Working Day", "Rest Day", "Public Holiday", "Leave", "Absent"];
const labelClass = "text-sm font-medium text-[#111827]";

type Party = {
  id: number;
  name: string;
  contactEmail?: string | null;
  assignedEmployees?: Array<{ id: number; name?: string | null; employeeId?: string | null; designation?: string | null }>;
};

type PoDoc = {
  id: number;
  number: string;
  partyName: string;
  partyId?: number | null;
  project?: string;
  workLocation?: string;
  employeeIds?: number[];
  employeeNames?: string;
  billingRate?: string;
  qtId?: number | null;
  qtNumber?: string;
};

type EmpOpt = { id: string; label: string };

async function fetchJson<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** Inclusive calendar days between Work From and Work To (e.g. 1 Nov–25 Nov = 25). */
function countInclusiveDays(from?: string, to?: string): number {
  const startIso = String(from || "").slice(0, 10);
  const endIso = String(to || from || "").slice(0, 10);
  if (!startIso) return 1;
  if (!endIso || endIso < startIso) return 1;
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  return Math.max(1, days);
}

function getRangeDayBreakdown(from?: string, to?: string) {
  const dates = expandEntryDates(from, to);
  let weekdays = 0;
  let weekendDays = 0;
  for (const dStr of dates) {
    const d = new Date(`${dStr}T00:00:00`);
    const day = d.getDay(); // 0 is Sunday, 6 is Saturday
    if (day === 0 || day === 6) {
      weekendDays++;
    } else {
      weekdays++;
    }
  }
  return { dates, totalDays: dates.length || 1, weekdays, weekendDays };
}

function scaleEntryHours(row: Pick<TimesheetEntry, "workFrom" | "workTo" | "workDate" | "dayType" | "normalHours" | "overtimeHours" | "days">) {
  const breakdown = getRangeDayBreakdown(row.workFrom || row.workDate, row.workTo || row.workDate);
  const isNormalWork = String(row.dayType || "").toLowerCase().includes("normal");
  const isRest = String(row.dayType || "").toLowerCase().includes("rest");

  let days: number;
  if (row.days != null && Number.isFinite(row.days) && row.days > 0) {
    days = row.days;
  } else if (isNormalWork && breakdown.dates.length > 1) {
    days = breakdown.weekdays; // 5 days per week (exclude Sat/Sun)
  } else if (isRest && breakdown.dates.length > 1 && breakdown.weekendDays > 0) {
    days = breakdown.weekendDays; // Sat & Sun
  } else {
    days = breakdown.totalDays;
  }

  const rawN = Number(row.normalHours) || 0;
  const rawO = Number(row.overtimeHours) || 0;
  // If multi-day row already stores range totals (e.g. 200), do not multiply again.
  if (days > 1 && rawN + rawO > 24) {
    const base = classifyEntryHours(row.dayType, row.normalHours, row.overtimeHours);
    return {
      days,
      normal: base.normal,
      ot15: base.ot15,
      ot20: base.ot20,
      restDay: base.restDay,
      publicHoliday: base.publicHoliday,
    };
  }
  const base = classifyEntryHours(row.dayType, row.normalHours, row.overtimeHours);
  return {
    days,
    normal: base.normal * days,
    ot15: base.ot15 * days,
    ot20: base.ot20 * days,
    restDay: base.restDay * days,
    publicHoliday: base.publicHoliday * days,
  };
}

function expandEntryDates(from?: string, to?: string): string[] {
  const startIso = String(from || "").slice(0, 10);
  const endIso = String(to || from || "").slice(0, 10);
  if (!startIso) return [];
  if (!endIso || endIso < startIso) return [startIso];
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function sumClassification(entries: TimesheetEntry[]) {
  // Attribute per-day hours to each calendar date; overlapping ranges do not double-count.
  const bestByDay = new Map<string, { normal: number; ot15: number; ot20: number; restDay: number; publicHoliday: number; line: number; span: number; isWorkingDay: boolean }>();
  for (const row of entries) {
    const dates = expandEntryDates(row.workFrom || row.workDate, row.workTo || row.workDate);
    const span = Math.max(1, dates.length || countInclusiveDays(row.workFrom || row.workDate, row.workTo || row.workDate));
    const rawN = Number(row.normalHours) || 0;
    const rawO = Number(row.overtimeHours) || 0;
    const looksPreScaled = span > 1 && rawN + rawO > 24;
    const normN = looksPreScaled ? Math.round((rawN / span) * 100) / 100 : rawN;
    const normO = looksPreScaled ? Math.round((rawO / span) * 100) / 100 : rawO;
    const isNormal = String(row.dayType || "").toLowerCase().includes("normal");
    const isRest = String(row.dayType || "").toLowerCase().includes("rest");
    const isHoliday = String(row.dayType || "").toLowerCase().includes("public") || String(row.dayType || "").toLowerCase().includes("holiday");

    const dayList = dates.length > 0 ? dates : ["_"];
    for (const date of dayList) {
      let dObj: Date | null = null;
      if (date !== "_") {
        dObj = new Date(`${date}T00:00:00`);
      }
      const isWeekend = dObj ? (dObj.getDay() === 0 || dObj.getDay() === 6) : false;

      // If user selected Normal Working Day:
      // Weekends (Sat/Sun) are off days — do not calculate normal or rest day hours!
      if (isNormal && isWeekend) {
        continue;
      }

      // If user row is a dedicated Rest Day / Public Holiday entry spanning a multi-day range:
      // It applies to weekends/non-regular days
      if ((isRest || isHoliday) && dates.length > 1 && !isWeekend) {
        continue;
      }

      const base = classifyEntryHours(row.dayType, normN, normO);
      const line = base.normal + base.ot15 + base.ot20 + base.restDay + base.publicHoliday;
      const isWorkingDay = isNormal && !isWeekend;

      const key = `${row.employeeId}|${date}`;
      const existing = bestByDay.get(key);
      if (!existing || line > existing.line || (line === existing.line && span > existing.span)) {
        bestByDay.set(key, { ...base, line, span, isWorkingDay });
      }
    }
  }
  return [...bestByDay.values()].reduce(
    (acc, c) => ({
      normal: acc.normal + c.normal,
      ot15: acc.ot15 + c.ot15,
      ot20: acc.ot20 + c.ot20,
      restDay: acc.restDay + c.restDay,
      publicHoliday: acc.publicHoliday + c.publicHoliday,
      workingDays: acc.workingDays + (c.isWorkingDay ? 1 : 0),
    }),
    { normal: 0, ot15: 0, ot20: 0, restDay: 0, publicHoliday: 0, workingDays: 0 },
  );
}

function calcHours(timeIn: string, timeOut: string, breakHours: string) {
  if (!timeIn || !timeOut) return { normal: "", overtime: "" };
  const toMins = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return (hour || 0) * 60 + (minute || 0);
  };
  let minutes = toMins(timeOut) - toMins(timeIn);
  if (minutes < 0) minutes += 24 * 60;
  const worked = Math.max(0, minutes / 60 - (Number(breakHours) || 0));
  const normal = Math.min(worked, 8);
  const overtime = Math.max(0, worked - 8);
  const text = (value: number) => String(Math.round(value * 100) / 100);
  return { normal: text(normal), overtime: text(overtime) };
}

function isoToDate(iso: string): Date | null {
  if (!iso) return null;
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function dateToIso(date?: Date | null) {
  if (!date) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseEmployeeIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  }
  return [];
}

function parseEmployeeNames(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
}

function mapSalesOrders(docs: any[]): PoDoc[] {
  return (docs || []).map((doc) => {
    const md = doc.manpowerDetails || {};
    const ids = parseEmployeeIds(md.employeeIds);
    return {
      id: Number(doc.id),
      number: String(doc.soNumber || ""),
      partyName: String(doc.customerName || ""),
      partyId: doc.customerId != null ? Number(doc.customerId) : null,
      project: String(md.project || ""),
      workLocation: String(md.workLocation || ""),
      employeeIds: ids,
      employeeNames: String(md.employeeNames || ""),
      billingRate: String(md.customerRate || md.customerBillingRates?.[0]?.rate || ""),
      qtId: doc.qtId != null ? Number(doc.qtId) : null,
      qtNumber: String(doc.qtNumber || ""),
    };
  }).filter((row) => row.number);
}

function mapPurchaseOrders(docs: any[]): PoDoc[] {
  return (docs || []).map((doc) => {
    const md = doc.manpowerDetails || {};
    const ids = parseEmployeeIds(md.employeeIds);
    return {
      id: Number(doc.id),
      number: String(doc.poNumber || ""),
      partyName: String(doc.vendorName || ""),
      partyId: doc.vendorId != null ? Number(doc.vendorId) : null,
      project: String(md.project || ""),
      workLocation: String(md.workLocation || doc.deliveryAddress || ""),
      employeeIds: ids,
      employeeNames: String(md.employeeNames || ""),
      billingRate: String(md.supplierRate || md.customerRate || md.customerBillingRates?.[0]?.rate || ""),
      qtId: null,
      qtNumber: "",
    };
  }).filter((row) => row.number);
}

function entryTotals(entries: TimesheetEntry[]) {
  const normal = entries.reduce((sum, row) => {
    const scaled = scaleEntryHours(row);
    const rawN = Number(row.normalHours) || 0;
    return sum + rawN * (scaled.days || 1);
  }, 0);
  const overtime = entries.reduce((sum, row) => {
    const scaled = scaleEntryHours(row);
    const rawO = Number(row.overtimeHours) || 0;
    return sum + rawO * (scaled.days || 1);
  }, 0);
  const restRow = entries.find((e) => String(e.dayType || "").toLowerCase().includes("rest"));
  const first = entries[0];
  return {
    normalHours: String(Math.round(normal * 100) / 100),
    overtimeHours: String(Math.round(overtime * 100) / 100),
    employeeId: first?.employeeId || "",
    employeeLabel: entries.length > 1
      ? `${entries.length} employees`
      : (first?.employeeLabel || ""),
    workLocation: first?.workLocation || "",
    workDate: first?.workDate || first?.workFrom || todayIso(),
    workFrom: first?.workFrom || first?.workDate || todayIso(),
    workTo: first?.workTo || first?.workDate || todayIso(),
    timeIn: first?.timeIn || "08:00",
    timeOut: first?.timeOut || "18:00",
    breakHours: first?.breakHours || "1",
    dayType: restRow?.dayType || first?.dayType || "Normal Working Day",
  };
}

export function CustomerTimesheetForm() {
  return <TimesheetForm side="customer" />;
}

export function SupplierTimesheetForm() {
  return <TimesheetForm side="supplier" />;
}

export default function TimesheetForm({ side }: { side: DeploymentSide }) {
  const [location, setLocation] = useLocation();
  const viewPattern = side === "customer"
    ? "/manpower/customers/timesheets/:id"
    : "/manpower/suppliers/timesheets/:id";
  const editPattern = side === "customer"
    ? "/manpower/customers/timesheets/:id/edit"
    : "/manpower/suppliers/timesheets/:id/edit";
  const [, viewParams] = useRoute(viewPattern);
  const [, editParams] = useRoute(editPattern);
  const isEdit = location.includes("/edit");
  const id = (isEdit ? editParams?.id : viewParams?.id) || "";
  const existing = useMemo(
    () => (id ? loadTimesheets().find((row) => row.id === id) || null : null),
    [id],
  );

  const { selectedCompany, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const companyId = selectedCompany?.id ?? null;
  const partyNoun = side === "customer" ? "Customer" : "Vendor";
  const listPath = side === "customer" ? "/manpower/customers/timesheets" : "/manpower/suppliers/timesheets";

  const { data: settings } = useGetSettings();
  const { data: salesOrders } = useListSalesOrders({
    query: { queryKey: getListSalesOrdersQueryKey(), enabled: side === "customer" },
  });
  const { data: purchaseOrders } = useListPurchaseOrders({
    query: { queryKey: getListPurchaseOrdersQueryKey(), enabled: side === "supplier" },
  });
  const { data: quotations } = useListQuotations({
    query: { queryKey: getListQuotationsQueryKey(), enabled: side === "customer" },
  });
  const { data: purchaseQuotations } = useListPurchaseQuotations({
    query: { queryKey: getListPurchaseQuotationsQueryKey(), enabled: side === "supplier" },
  });

  const { data: parties = [] } = useQuery({
    queryKey: ["timesheet-parties", side],
    queryFn: () => fetchJson<Party>(side === "customer" ? "/api/customers" : "/api/vendors"),
  });
  const { data: allEmployees = [] } = useQuery({
    queryKey: ["timesheet-employees"],
    queryFn: () => fetchJson<{ id: number; name?: string | null; employeeId?: string | null; designation?: string | null }>("/api/employees"),
  });

  const allPos = useMemo(
    () => (side === "customer" ? mapSalesOrders(salesOrders as any[]) : mapPurchaseOrders(purchaseOrders as any[])),
    [side, salesOrders, purchaseOrders],
  );

  const runningNo = useMemo(() => {
    const prefix = String((settings as { tsPrefix?: string } | undefined)?.tsPrefix ?? "TS");
    const counter = (Number((settings as { tsCounter?: number } | undefined)?.tsCounter) || 0) + 1;
    const suffix = String((settings as { tsSuffix?: string } | undefined)?.tsSuffix ?? "");
    return { counter, value: `${prefix}${counter}${suffix}` };
  }, [settings]);

  const initialEntry = existing?.entries?.[0];
  const initialRestEntry = existing?.entries?.find((e) => String(e.dayType || "").toLowerCase().includes("rest"));
  const [timesheetNo] = useState(() => existing?.timesheetNo ?? "");
  const [project, setProject] = useState(() => existing?.project ?? "");
  const [partyId, setPartyId] = useState(() => existing?.partyId ?? "");
  const [poId, setPoId] = useState(() => existing?.poId ?? "");
  const [entries, setEntries] = useState<TimesheetEntry[]>(() => existing?.entries ?? []);
  const [employeeKey, setEmployeeKey] = useState(() => initialEntry?.employeeId || existing?.employeeId || "");
  const [workLocation, setWorkLocation] = useState(() => initialEntry?.workLocation || existing?.workLocation || "");
  const [workFrom, setWorkFrom] = useState(() => existing?.workFrom || initialEntry?.workFrom || existing?.workDate || initialEntry?.workDate || todayIso());
  const [workTo, setWorkTo] = useState(() => existing?.workTo || initialEntry?.workTo || existing?.workDate || initialEntry?.workDate || todayIso());
  const [timeIn, setTimeIn] = useState(() => initialEntry?.timeIn || existing?.timeIn || "08:00");
  const [timeOut, setTimeOut] = useState(() => initialEntry?.timeOut || existing?.timeOut || "18:00");
  const [breakHours, setBreakHours] = useState(() => initialEntry?.breakHours || existing?.breakHours || "1");
  const [normalHours, setNormalHours] = useState(() => initialEntry?.normalHours || existing?.normalHours || "8");
  const [overtimeHours, setOvertimeHours] = useState(() => initialEntry?.overtimeHours || existing?.overtimeHours || "1");
  const [dayType, setDayType] = useState(() => (initialRestEntry ? "Rest Day" : (existing?.dayType === "Rest Day" ? "Rest Day" : (existing?.dayType || initialEntry?.dayType || "Normal Working Day"))));
  const [remarks, setRemarks] = useState(() => existing?.remarks ?? "");
  const [approvedBy, setApprovedBy] = useState(() => existing?.approvedBy ?? "");
  const [formStatus, setFormStatus] = useState<"draft" | "approved">(
    existing?.status === "approved" ? "approved" : "draft",
  );
  const [saved, setSaved] = useState<Timesheet | null>(existing);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [ackToken, setAckToken] = useState(existing?.approvalToken || "");
  const readOnly = Boolean(existing) && !isEdit;

  useEffect(() => {
    if (!existing) return;
    const fe = existing.entries?.[0];
    const re = existing.entries?.find((e) => String(e.dayType || "").toLowerCase().includes("rest"));
    if (existing.partyId) setPartyId(existing.partyId);
    if (existing.poId) setPoId(existing.poId);
    if (existing.project) setProject(existing.project);
    if (existing.remarks) setRemarks(existing.remarks);
    if (existing.approvedBy) setApprovedBy(existing.approvedBy);
    if (existing.entries && existing.entries.length > 0) setEntries(existing.entries);
    const wf = existing.workFrom || fe?.workFrom || existing.workDate || fe?.workDate;
    if (wf) setWorkFrom(wf);
    const wt = existing.workTo || fe?.workTo || existing.workDate || fe?.workDate;
    if (wt) setWorkTo(wt);
    const empId = fe?.employeeId || existing.employeeId;
    if (empId) setEmployeeKey(empId);
    setDayType(re?.dayType || (existing.dayType === "Rest Day" ? "Rest Day" : (existing.dayType || fe?.dayType || "Normal Working Day")));
    if (fe?.workLocation || existing.workLocation) setWorkLocation(fe?.workLocation || existing.workLocation || "");
    if (fe?.timeIn || existing.timeIn) setTimeIn(fe?.timeIn || existing.timeIn || "08:00");
    if (fe?.timeOut || existing.timeOut) setTimeOut(fe?.timeOut || existing.timeOut || "18:00");
    if (fe?.breakHours || existing.breakHours) setBreakHours(fe?.breakHours || existing.breakHours || "1");
    if (fe?.normalHours || existing.normalHours) setNormalHours(fe?.normalHours || existing.normalHours || "8");
    if (fe?.overtimeHours || existing.overtimeHours) setOvertimeHours(fe?.overtimeHours || existing.overtimeHours || "1");
  }, [existing]);

  const shownNo = existing?.timesheetNo || timesheetNo || runningNo.value;
  const selectedParty = parties.find((party) => String(party.id) === String(partyId)) ?? null;
  const relatedPos = useMemo(() => {
    if (!partyId && !selectedParty) return [];
    return allPos.filter((doc) => {
      if (doc.partyId != null && partyId && String(doc.partyId) === String(partyId)) return true;
      if (selectedParty?.name && doc.partyName.trim().toLowerCase() === selectedParty.name.trim().toLowerCase()) return true;
      return false;
    });
  }, [allPos, partyId, selectedParty]);

  const selectedPo = relatedPos.find((doc) => String(doc.id) === String(poId))
    || allPos.find((doc) => String(doc.id) === String(poId))
    || null;

  const linkedQuotations = useMemo(() => {
    const rows = side === "customer"
      ? (Array.isArray(quotations) ? (quotations as any[]) : [])
      : (Array.isArray(purchaseQuotations) ? (purchaseQuotations as any[]) : []);
    if (!rows.length) return [] as any[];
    const matched: any[] = [];
    if (selectedPo?.qtId != null) {
      const byId = rows.find((row) => Number(row.id) === Number(selectedPo.qtId));
      if (byId) matched.push(byId);
    }
    if (selectedPo?.qtNumber) {
      const key = String(selectedPo.qtNumber).trim().toUpperCase();
      const byNo = rows.find((row) =>
        String(row.qtNumber || row.pqNumber || "").trim().toUpperCase() === key
      );
      if (byNo && !matched.some((row) => Number(row.id) === Number(byNo.id))) matched.push(byNo);
    }
    // Same party quotations (covers older docs that lost employeeIds)
    const partyName = (selectedParty?.name || selectedPo?.partyName || "").trim().toLowerCase();
    const partyIdNum = selectedParty?.id != null ? Number(selectedParty.id) : (selectedPo?.partyId != null ? Number(selectedPo.partyId) : null);
    rows.forEach((row) => {
      const rowPartyId = side === "customer" ? row.customerId : row.vendorId;
      const rowPartyName = side === "customer" ? row.customerName : row.vendorName;
      const sameId = partyIdNum != null && rowPartyId != null && Number(rowPartyId) === partyIdNum;
      const sameName = partyName && String(rowPartyName || "").trim().toLowerCase() === partyName;
      if ((sameId || sameName) && !matched.some((m) => Number(m.id) === Number(row.id))) matched.push(row);
    });
    return matched;
  }, [side, selectedPo, selectedParty, quotations, purchaseQuotations]);

  const employeeOptions: EmpOpt[] = useMemo(() => {
    if (!selectedPo && !selectedParty) return [];

    const labelFor = (
      emp: { id?: number | string; name?: string | null; employeeId?: string | null; designation?: string | null } | undefined,
      fallback?: string,
    ) => {
      if (emp?.name || emp?.employeeId) {
        return `${emp.name || "Employee"}${emp.employeeId ? ` (${emp.employeeId})` : ""}${emp.designation ? ` — ${emp.designation}` : ""}`;
      }
      return fallback || String(emp?.id || "");
    };

    const poIds = parseEmployeeIds(selectedPo?.employeeIds);
    const poNames = parseEmployeeNames(selectedPo?.employeeNames);

    // 1. If the selected PO / Sales Order has its own assigned employees, show ONLY those.
    const uniquePoIds = [...new Set(poIds)];
    if (uniquePoIds.length) {
      return uniquePoIds.map((id) => {
        const emp = allEmployees.find((row) => Number(row.id) === Number(id));
        return { id: String(id), label: labelFor(emp, String(id)) };
      });
    }
    const uniquePoNames = [...new Set(poNames)];
    if (uniquePoNames.length) {
      return uniquePoNames.map((name, index) => ({ id: `named-${index}-${name}`, label: name }));
    }

    // 2. Otherwise fall back to employees from linked quotations (for older POs without employeeIds).
    const qtIds: number[] = [];
    const qtNames: string[] = [];
    linkedQuotations.forEach((qt) => {
      const md = qt?.manpowerDetails || {};
      qtIds.push(...parseEmployeeIds(md.employeeIds));
      qtNames.push(...parseEmployeeNames(md.employeeNames));
    });

    const uniqueQtIds = [...new Set(qtIds)];
    if (uniqueQtIds.length) {
      return uniqueQtIds.map((id) => {
        const emp = allEmployees.find((row) => Number(row.id) === Number(id));
        return { id: String(id), label: labelFor(emp, String(id)) };
      });
    }

    const uniqueQtNames = [...new Set(qtNames)];
    if (uniqueQtNames.length) {
      return uniqueQtNames.map((name, index) => ({ id: `named-${index}-${name}`, label: name }));
    }

    const assigned = selectedParty?.assignedEmployees || [];
    if (assigned.length) {
      return assigned.map((emp) => ({ id: String(emp.id), label: labelFor(emp) }));
    }

    // Last fallback so timesheet is usable if PO/customer has no linked employees yet
    if (selectedPo && allEmployees.length) {
      return allEmployees.map((emp) => ({ id: String(emp.id), label: labelFor(emp) }));
    }

    return [];
  }, [selectedPo, selectedParty, allEmployees, linkedQuotations]);

  const classification = useMemo(() => sumClassification(entries), [entries]);

  useEffect(() => {
    if (readOnly || !employeeKey) return;
    if (employeeOptions.length > 0 && !employeeOptions.some((o) => o.id === employeeKey)) {
      setEmployeeKey("");
    }
  }, [readOnly, employeeKey, employeeOptions]);

  useEffect(() => {
    if (readOnly) return;
    const next = calcHours(timeIn, timeOut, breakHours);
    if (next.normal) setNormalHours(next.normal);
    if (next.overtime) setOvertimeHours(next.overtime);
  }, [timeIn, timeOut, breakHours, readOnly]);

  function resetEntryFields(keepLocation = true) {
    setEmployeeKey("");
    if (!keepLocation) setWorkLocation("");
    setTimeIn("08:00");
    setTimeOut("18:00");
    setBreakHours("1");
    setNormalHours("8");
    setOvertimeHours("1");
  }

  function onPartyChange(value: string) {
    setPartyId(value);
    setPoId("");
    setEntries([]);
    setProject("");
    setWorkLocation("");
    resetEntryFields(false);
  }

  function onPoChange(value: string) {
    setPoId(value);
    const doc = relatedPos.find((row) => String(row.id) === String(value)) || allPos.find((row) => String(row.id) === String(value));
    if (!doc) return;
    if (doc.project) setProject(doc.project);
    if (doc.workLocation) setWorkLocation(doc.workLocation);
    resetEntryFields(true);
  }

  function partyEmail(id: string) {
    return parties.find((party) => String(party.id) === id)?.contactEmail || "";
  }

  function addEntry() {
    if (readOnly) return;
    if (!employeeKey) {
      toast({ title: "Select employee", variant: "destructive" });
      return;
    }
    if (!workFrom) {
      toast({ title: "Select Work From date", variant: "destructive" });
      return;
    }
    if (!workTo) {
      toast({ title: "Select Work To date", variant: "destructive" });
      return;
    }
    if (workTo < workFrom) {
      toast({ title: "Work To must be on or after Work From", variant: "destructive" });
      return;
    }
    const emp = employeeOptions.find((row) => row.id === employeeKey);
    const breakdown = getRangeDayBreakdown(workFrom, workTo);
    const isRest = String(dayType || "").toLowerCase().includes("rest");
    const isHoliday = String(dayType || "").toLowerCase().includes("public") || String(dayType || "").toLowerCase().includes("holiday");
    const isMultiDay = breakdown.dates.length > 1;

    const newEntries: TimesheetEntry[] = [];

    if ((isRest || isHoliday) && isMultiDay && breakdown.weekdays > 0 && breakdown.weekendDays > 0) {
      // User selected Rest Day (or Public Holiday) for a date range spanning weekdays & weekends:
      // Show BOTH Normal Working Days and Rest Days (or Public Holiday) in the table!
      const normalEntry: TimesheetEntry = {
        id: `${Date.now()}-${employeeKey}-normal`,
        employeeId: employeeKey,
        employeeLabel: emp?.label || employeeKey,
        workLocation: workLocation.trim(),
        workDate: workFrom,
        workFrom,
        workTo,
        timeIn,
        timeOut,
        breakHours,
        normalHours,
        overtimeHours,
        dayType: "Normal Working Day",
        days: breakdown.weekdays,
      };

      const specialEntry: TimesheetEntry = {
        id: `${Date.now() + 1}-${employeeKey}-${isRest ? "rest" : "holiday"}`,
        employeeId: employeeKey,
        employeeLabel: emp?.label || employeeKey,
        workLocation: workLocation.trim(),
        workDate: workFrom,
        workFrom,
        workTo,
        timeIn,
        timeOut,
        breakHours,
        normalHours,
        overtimeHours,
        dayType: isRest ? "Rest Day" : "Public Holiday",
        days: breakdown.weekendDays,
      };

      newEntries.push(specialEntry, normalEntry);
      toast({ title: `Added ${breakdown.weekendDays} ${isRest ? "Rest" : "Holiday"} days and ${breakdown.weekdays} Normal days.` });
    } else {
      // Normal Working Day selected, or single day:
      // If Normal Working Day: weekends are excluded (only 5 days/week counted). Rest Day is NOT added.
      const isNormal = String(dayType || "").toLowerCase().includes("normal");
      let entryDays: number;
      if (isNormal) {
        entryDays = isMultiDay ? breakdown.weekdays : (breakdown.weekdays > 0 ? 1 : 0);
      } else if (isRest) {
        entryDays = isMultiDay && breakdown.weekendDays > 0 ? breakdown.weekendDays : breakdown.totalDays;
      } else {
        entryDays = breakdown.totalDays;
      }

      const singleEntry: TimesheetEntry = {
        id: `${Date.now()}-${employeeKey}`,
        employeeId: employeeKey,
        employeeLabel: emp?.label || employeeKey,
        workLocation: workLocation.trim(),
        workDate: workFrom,
        workFrom,
        workTo,
        timeIn,
        timeOut,
        breakHours,
        normalHours,
        overtimeHours,
        dayType,
        days: entryDays,
      };
      newEntries.push(singleEntry);
      toast({ title: `Employee hours saved (${entryDays} ${isNormal ? "normal working" : isRest ? "rest" : ""} days).` });
    }

    setEntries((prev) => {
      const newDayTypes = new Set(newEntries.map((e) => e.dayType));
      const withoutDup = prev.filter((row) => !(
        row.employeeId === employeeKey
        && (row.workFrom || row.workDate) === workFrom
        && (row.workTo || row.workDate) === workTo
        && newDayTypes.has(row.dayType)
      ));
      return [...withoutDup, ...newEntries];
    });
    resetEntryFields(true);
  }

  function removeEntry(entryId: string) {
    setEntries((prev) => prev.filter((row) => row.id !== entryId));
  }

  async function submit() {
    if (!partyId) {
      toast({ title: `Select ${partyNoun.toLowerCase()}`, variant: "destructive" });
      return;
    }
    if (!poId) {
      toast({ title: "Select PO Reference No.", variant: "destructive" });
      return;
    }
    if (entries.length === 0) {
      toast({ title: "Save at least one employee", variant: "destructive" });
      return;
    }
    const totals = entryTotals(entries);
    const hasRest = entries.some((e) => String(e.dayType || "").toLowerCase().includes("rest"));
    const hasHoliday = entries.some((e) => String(e.dayType || "").toLowerCase().includes("public") || String(e.dayType || "").toLowerCase().includes("holiday"));
    const savedDayType = hasRest ? "Rest Day" : hasHoliday ? "Public Holiday" : (dayType || totals.dayType);
    const savedWorkFrom = workFrom || totals.workFrom || entries[0]?.workFrom || totals.workDate;
    const savedWorkTo = workTo || totals.workTo || entries[0]?.workTo || totals.workDate;

    const record: Timesheet = {
      id: saved?.id ?? existing?.id ?? `${Date.now()}`,
      companyId,
      side,
      timesheetNo: shownNo,
      project: project.trim(),
      poReference: selectedPo?.number || existing?.poReference || "",
      poId: String(selectedPo?.id || poId),
      employeeId: totals.employeeId,
      employeeLabel: totals.employeeLabel,
      partyId,
      partyName: selectedParty?.name || existing?.partyName || "",
      partyEmail: partyEmail(partyId),
      workLocation: totals.workLocation,
      workDate: savedWorkFrom,
      workFrom: savedWorkFrom,
      workTo: savedWorkTo,
      timeIn: totals.timeIn,
      timeOut: totals.timeOut,
      breakHours: totals.breakHours,
      normalHours: totals.normalHours,
      overtimeHours: totals.overtimeHours,
      dayType: savedDayType,
      remarks: remarks.trim(),
      submittedBy: user?.username || "Admin",
      approvedBy: approvedBy.trim(),
      status: formStatus,
      sentTo: existing?.sentTo ?? "",
      billingRate: selectedPo?.billingRate?.trim() || existing?.billingRate || "",
      otBillingRate: (() => {
        const base = Number(String(selectedPo?.billingRate || existing?.billingRate || "").replace(/[^0-9.]/g, ""));
        return base > 0 ? String(Math.round(base * 1.5 * 100) / 100) : (existing?.otBillingRate || "");
      })(),
      entries,
    };
    saveTimesheet(record);
    if (isEdit) {
      toast({ title: "Timesheet updated." });
      setLocation(listPath);
      return;
    }
    if (!existing && !saved) {
      await fetch("/api/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tsCounter: runningNo.counter }),
      });
      queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    }
    setSaved(record);
    toast({ title: "Timesheet submitted." });
    setLocation(listPath);
  }

  const current = saved || existing;
  async function applyRemoteStatuses(sheet: Timesheet) {
    if (!sheet.approvalToken) return;
    try {
      const remote = await syncTimesheetAckStatus(sheet.approvalToken);
      const status = localStatusFromAck(remote.status);
      if (!status || status === sheet.status) return;
      updateTimesheet(sheet.id, { status });
      setSaved({ ...sheet, status });
    } catch {
      /* ignore */
    }
  }

  async function ensureAckToken(sheet: Timesheet) {
    if (sheet.approvalToken) return sheet.approvalToken;
    try {
      const created = await createTimesheetAck(sheet);
      setAckToken(created.token);
      updateTimesheet(sheet.id, { approvalToken: created.token });
      setSaved({ ...sheet, approvalToken: created.token });
      return created.token;
    } catch {
      return "";
    }
  }

  useEffect(() => {
    if (!current || current.status === "draft") return;
    void (async () => {
      const token = await ensureAckToken(current);
      if (token) await applyRemoteStatuses({ ...current, approvalToken: token });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  function remove() {
    if (!existing) return;
    removeTimesheet(existing.id);
    toast({ title: "Timesheet deleted." });
    setLocation(listPath);
  }

  const approvalLabel = side === "customer" ? "Customer Approval" : "Vendor Approval";
  const classRows = [
    { label: "Working Days", value: classification.workingDays },
    { label: "Normal Hours", value: classification.normal },
    { label: "OT 1.5x", value: classification.ot15 },
    { label: "OT 2.0x", value: classification.ot20 },
    { label: "Rest Day", value: classification.restDay },
    { label: "Public Holiday", value: classification.publicHoliday },
  ];

  return (
    <>
      <FormPageShell
        title={isEdit ? "Edit Timesheet" : existing ? "Timesheet" : "New Timesheet"}
        backHref={listPath}
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            {isEdit && existing ? (
              <Button type="button" variant="ghost" size="icon" className="text-destructive" aria-label="Delete timesheet" onClick={remove}>
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : <span />}
            <div className="flex items-center gap-3">
              <ModalCancelButton onClick={() => setLocation(listPath)} label={readOnly ? "Back" : "Cancel"} />
              {!readOnly && <ModalSaveButton type="button" onClick={submit} label={isEdit ? "Save" : "Submit Timesheet"} />}
              {readOnly && current && current.status !== "draft" && (
                <ModalSaveButton type="button" onClick={() => setPreviewOpen(true)} label={`${partyNoun} Approval`} />
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-8">
          <section className="space-y-4">
            <ModalSectionHeader title="Daily Timesheet" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Readonly label="Timesheet No." value={shownNo} mono />
              <Field label="Project">
                <Input value={project} onChange={(event) => setProject(event.target.value)} readOnly={readOnly} placeholder="Project" />
              </Field>
              <Field label={partyNoun}>
                <Select value={partyId || undefined} onValueChange={onPartyChange} disabled={readOnly}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={`Select ${partyNoun.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {parties.length === 0 ? (
                      <SelectItem value="__none" disabled>No {partyNoun.toLowerCase()}s found</SelectItem>
                    ) : parties.map((party) => (
                      <SelectItem key={party.id} value={String(party.id)}>{party.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="PO Reference No.">
                <Select value={poId || undefined} onValueChange={onPoChange} disabled={readOnly || !partyId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={partyId ? "Select PO" : `Select ${partyNoun.toLowerCase()} first`} />
                  </SelectTrigger>
                  <SelectContent>
                    {relatedPos.length === 0 ? (
                      <SelectItem value="__none" disabled>No POs found</SelectItem>
                    ) : relatedPos.map((doc) => (
                      <SelectItem key={doc.id} value={String(doc.id)}>{doc.number}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </section>

          {!readOnly && (
            <>
              <section className="space-y-4">
                <ModalSectionHeader title="Employee Details" />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Employee">
                    <Select value={employeeKey || undefined} onValueChange={setEmployeeKey} disabled={!poId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={poId ? "Select employee" : "Select PO first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {employeeOptions.length === 0 ? (
                          <SelectItem value="__none" disabled>No employees found</SelectItem>
                        ) : employeeOptions.map((emp) => (
                          <SelectItem key={emp.id} value={emp.id}>{emp.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Worksite">
                    <Input value={workLocation} onChange={(event) => setWorkLocation(event.target.value)} />
                  </Field>
                  <Field label="Work From">
                    <SimpleDatePicker
                      date={isoToDate(workFrom)}
                      setDate={(date) => {
                        const next = dateToIso(date);
                        setWorkFrom(next);
                        if (workTo && next && workTo < next) setWorkTo(next);
                      }}
                    />
                  </Field>
                  <Field label="Work To">
                    <SimpleDatePicker
                      date={isoToDate(workTo)}
                      setDate={(date) => setWorkTo(dateToIso(date))}
                    />
                  </Field>
                </div>
              </section>

              <section className="space-y-4">
                <ModalSectionHeader title="Working Hours" />
                <div className={formFieldGridClass}>
                  <Field label="Time In">
                    <TimePickerInput value={timeIn} onChange={setTimeIn} />
                  </Field>
                  <Field label="Time Out">
                    <TimePickerInput value={timeOut} onChange={setTimeOut} />
                  </Field>
                  <Field label="Break Hours">
                    <Input inputMode="decimal" value={breakHours} onChange={(event) => setBreakHours(event.target.value)} />
                  </Field>
                  <Field label="Normal Hours">
                    <Input inputMode="decimal" value={normalHours} onChange={(event) => setNormalHours(event.target.value)} />
                    <p className="text-[11px] text-[#6B7280]">Per day — multiplied by Work From–To days</p>
                  </Field>
                  <Field label="Overtime Hours">
                    <Input inputMode="decimal" value={overtimeHours} onChange={(event) => setOvertimeHours(event.target.value)} />
                    <p className="text-[11px] text-[#6B7280]">Per day — multiplied by Work From–To days</p>
                  </Field>
                  <Field label="Day Type">
                    <Select value={dayType} onValueChange={setDayType}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select day type" />
                      </SelectTrigger>
                      <SelectContent>
                        {DAY_TYPES.map((item) => (
                          <SelectItem key={item} value={item}>{item}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <div className="flex justify-end">
                  <Button type="button" onClick={addEntry} className="bg-[#2563EB] text-white hover:bg-[#1D4ED8]">
                    Save
                  </Button>
                </div>
              </section>
            </>
          )}

          <section className="space-y-4">
            <ModalSectionHeader title="Saved Employees" />
            <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Work From</TableHead>
                    <TableHead>Work To</TableHead>
                    <TableHead>Worksite</TableHead>
                    <TableHead>Time In</TableHead>
                    <TableHead>Time Out</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Normal / day</TableHead>
                    <TableHead className="text-right">OT / day</TableHead>
                    <TableHead className="text-right">Normal Total</TableHead>
                    <TableHead className="text-right">OT Total</TableHead>
                    <TableHead>Day Type</TableHead>
                    <TableHead className="text-right">Total Hours</TableHead>
                    {!readOnly && <TableHead className="w-16"> </TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={readOnly ? 13 : 14} className="h-24 text-center text-muted-foreground">
                        No employees saved yet.
                      </TableCell>
                    </TableRow>
                  ) : entries.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.employeeLabel}</TableCell>
                      <TableCell>{formatDisplayDate(row.workFrom || row.workDate)}</TableCell>
                      <TableCell>{formatDisplayDate(row.workTo || row.workDate)}</TableCell>
                      <TableCell>{row.workLocation || "—"}</TableCell>
                      <TableCell>{row.timeIn}</TableCell>
                      <TableCell>{row.timeOut}</TableCell>
                      {(() => {
                        const scaled = scaleEntryHours(row);
                        const days = scaled.days;
                        const rawN = Number(row.normalHours) || 0;
                        const rawO = Number(row.overtimeHours) || 0;
                        const normalTotal = Math.round(rawN * days * 100) / 100;
                        const otTotal = Math.round(rawO * days * 100) / 100;
                        return (
                          <>
                            <TableCell className="text-right tabular-nums">{days}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.normalHours}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.overtimeHours}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{normalTotal}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{otTotal}</TableCell>
                            <TableCell>{row.dayType}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {Math.round((normalTotal + otTotal) * 100) / 100}
                            </TableCell>
                          </>
                        );
                      })()}
                      {!readOnly && (
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            aria-label="Remove entry"
                            onClick={() => removeEntry(row.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-[#111827]">Working Hours Classification</h3>
              <p className="text-xs text-[#6B7280]">
                Totals = daily hours × days in Work From–To (e.g. 8 normal × 25 days = 200).
              </p>
            </div>
            <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E7EB] bg-[#F8FAFC] text-[#6B7280]">
                    <th className="px-4 py-3 text-left font-medium">Category</th>
                    <th className="px-4 py-3 text-right font-medium">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {classRows.map((row) => (
                    <tr key={row.label} className="border-b border-[#F1F5F9] last:border-b-0">
                      <td className="px-4 py-3 text-[#111827]">{row.label}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[#111827]">{Math.round(row.value * 100) / 100}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Field label="Remarks">
              <Textarea
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                placeholder="Enter work details or remarks..."
                readOnly={readOnly}
                rows={3}
              />
            </Field>
          </section>

          <section className="space-y-4">
            <ModalSectionHeader title="Approval Details" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Readonly label="Submitted By" value={current?.submittedBy || user?.username || "Admin"} />
              <Readonly
                label={approvalLabel}
                value={
                  current?.status === "approved" || formStatus === "approved"
                    ? "Confirmed"
                    : current?.status === "rejected"
                      ? "Rejected"
                      : "Pending"
                }
              />
              <Field label="Approved By">
                {readOnly ? (
                  <div className="flex min-h-10 items-center rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-sm text-[#111827]">
                    <span className="min-w-0 break-words">{approvedBy || current?.approvedBy || "—"}</span>
                  </div>
                ) : (
                  <Input
                    value={approvedBy}
                    onChange={(event) => setApprovedBy(event.target.value)}
                    placeholder="Approved by"
                  />
                )}
              </Field>
              <Field label="Status">
                {readOnly ? (
                  <div className="flex min-h-10 items-center rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-sm text-[#111827]">
                    <span className="min-w-0 break-words">{formStatus === "approved" ? "Approved" : "Draft"}</span>
                  </div>
                ) : (
                  <Select value={formStatus} onValueChange={(value) => setFormStatus(value as "draft" | "approved")}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </div>
          </section>
        </div>
      </FormPageShell>

      {current && (
        <TimesheetApprovalDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          sheet={current}
          onStatus={(status) => {
            setSaved({ ...current, status, approvalToken: ackToken || current.approvalToken });
            toast({ title: status === "approved" ? "Confirmed." : "Rejected." });
          }}
          onSent={(recipients) => {
            const sentTo = recipients.join(", ");
            updateTimesheet(current.id, { sentTo, approvalToken: ackToken || current.approvalToken });
            setSaved({ ...current, sentTo, approvalToken: ackToken || current.approvalToken });
            toast({ title: `Sent to ${partyNoun.toLowerCase()}.` });
          }}
        />
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className={labelClass}>{label}</Label>
      {children}
    </div>
  );
}

function Readonly({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Field label={label}>
      <div className={`flex min-h-10 items-center rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-3 py-2 text-sm text-[#111827] ${mono ? "font-mono" : ""}`}>
        <span className="min-w-0 break-words">{value}</span>
      </div>
    </Field>
  );
}
