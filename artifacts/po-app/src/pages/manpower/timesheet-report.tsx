import { useEffect, useMemo, useState, type ReactNode  } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  FileSpreadsheet,
  FileText,
  PieChart as PieChartIcon,
  Printer,
  Search,
  Users,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SimpleDatePicker } from "@/components/ui/simple-date-picker";
import { useAuth } from "@/contexts/auth-context";
import { loadDeployments, type DeploymentSide } from "./deployment-store";
import { loadTimesheets, updateTimesheet, type Timesheet } from "./timesheet-store";

type EmployeeRow = {
  id: number;
  employeeId?: string | null;
  name?: string | null;
  department?: string | null;
  designation?: string | null;
};

type Filters = {
  from: string;
  to: string;
  employee: string;
  department: string;
  party: string;
};

type ReportRow = {
  id: string;
  employeeName: string;
  designation: string;
  department: string;
  dateIso: string;
  dateLabel: string;
  checkIn: string;
  checkOut: string;
  normal: number;
  ot: number;
  total: number;
  rate: number;
  otRate: number;
  normalAmount: number;
  otAmount: number;
  totalAmount: number;
  status: Timesheet["status"];
  absent: boolean;
  partyName: string;
};

const PAGE_SIZE = 5;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toIso(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseIso(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

function slashDate(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

function monthStart() {
  const now = new Date();
  return toIso(new Date(now.getFullYear(), now.getMonth(), 1));
}

function monthEnd() {
  const now = new Date();
  return toIso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

function defaultFilters(): Filters {
  return { from: monthStart(), to: monthEnd(), employee: "all", department: "all", party: "all" };
}

function employeeName(label: string) {
  const names = label
    .split(",")
    .map((part) => part.split("–")[0].split("—")[0].replace(/\s+-\s+EMP.*$/i, "").trim())
    .filter(Boolean);
  return names.join(", ") || "—";
}

function clockLabel(value: string) {
  if (!value) return "—";
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${pad(hour12)}:${pad(Number.isFinite(minute) ? minute : 0)} ${suffix}`;
}

function sameText(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function sameId(left: number | null, right: number | null) {
  if (left == null || right == null) return left == null && right == null;
  return String(left) === String(right);
}

function hoursText(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function moneyText(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseRate(value: unknown) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function backfillTimesheetRates(side: DeploymentSide, companyId: number | null) {
  const deployments = loadDeployments();
  loadTimesheets()
    .filter((row) => row.side === side && sameId(row.companyId, companyId))
    .forEach((row) => {
      if (parseRate(row.billingRate) > 0) return;
      const deployment = resolveDeployment(row, deployments);
      const rate = parseRate(deployment?.billingRate) || parseRate(deployment?.payRate);
      if (rate <= 0) return;
      updateTimesheet(row.id, {
        billingRate: String(rate),
        otBillingRate: String(Math.round(rate * 1.5 * 100) / 100),
      });
    });
}

function resolveDeployment(row: Timesheet, deployments: ReturnType<typeof loadDeployments>) {
  return (
    deployments.find((item) => item.id === row.deploymentId) ||
    deployments.find((item) =>
      item.side === row.side &&
      String(item.deploymentNo || "").trim() === String(row.deploymentNo || "").trim() &&
      String(item.partyId || "") === String(row.partyId || "")
    ) ||
    undefined
  );
}

function statusLabel(status: Timesheet["status"]) {
  if (status === "approved") return "Confirmed";
  if (status === "submitted") return "Pending";
  if (status === "rejected") return "Rejected";
  return "Draft";
}

function statusClass(status: Timesheet["status"]) {
  if (status === "approved") return "border-[#BBF7D0] bg-[#ECFDF3] text-[#16A34A]";
  if (status === "rejected") return "border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]";
  if (status === "submitted") return "border-[#FDE68A] bg-[#FFF7ED] text-[#D97706]";
  return "border-[#E5E7EB] bg-[#F8FAFC] text-[#64748B]";
}

function addDays(iso: string, days: number) {
  const date = parseIso(iso);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

function mondayOf(iso: string) {
  const date = parseIso(iso);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return toIso(date);
}

async function fetchEmployees(): Promise<EmployeeRow[]> {
  const res = await fetch("/api/employees", { credentials: "include" });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export function CustomerTimesheetReport() {
  return <TimesheetReport side="customer" />;
}

export function SupplierTimesheetReport() {
  return <TimesheetReport side="supplier" />;
}

export default function TimesheetReport({ side }: { side: DeploymentSide }) {
  const { selectedCompany } = useAuth();
  const companyId = selectedCompany?.id ?? null;
  const partyLabel = side === "customer" ? "Customer" : "Vendor";
  const base = side === "customer" ? "/manpower/customers/timesheets" : "/manpower/suppliers/timesheets";
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [applied, setApplied] = useState<Filters>(defaultFilters);
  const [sheets, setSheets] = useState(() => loadTimesheets());
  const [trend, setTrend] = useState<"weekly" | "monthly" | "custom">("weekly");
  const [page, setPage] = useState(1);
  const [reportKey, setReportKey] = useState(0);

  const { data: employees = [] } = useQuery({
    queryKey: ["timesheet-report-employees"],
    queryFn: fetchEmployees,
  });

  useEffect(() => {
    backfillTimesheetRates(side, companyId);
    setSheets(loadTimesheets());
  }, [side, companyId]);

  const rows = useMemo(() => {
    const deployments = loadDeployments();
    return sheets
      .filter((row) => row.side === side && sameId(row.companyId, companyId))
      .flatMap((row) => toReportRows(row, deployments, employees));
  }, [sheets, side, companyId, employees]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (applied.from && row.dateIso < applied.from) return false;
      if (applied.to && row.dateIso > applied.to) return false;
      if (applied.employee !== "all" && !sameText(row.employeeName, applied.employee)) return false;
      if (applied.department !== "all" && !sameText(row.department, applied.department)) return false;
      if (applied.party !== "all" && !sameText(row.partyName, applied.party)) return false;
      return true;
    });
  }, [rows, applied]);

  const employeeOptions = useMemo(() => unique(rows.map((row) => row.employeeName)), [rows]);
  const departmentOptions = useMemo(() => unique(rows.map((row) => row.department)), [rows]);
  const partyOptions = useMemo(() => unique(rows.map((row) => row.partyName).filter((name) => name && name !== "—")), [rows]);

  const totals = useMemo(() => {
    const people = new Set(filtered.map((row) => row.employeeName).filter((name) => name !== "—"));
    const normal = filtered.reduce((sum, row) => sum + row.normal, 0);
    const ot = filtered.reduce((sum, row) => sum + row.ot, 0);
    const normalAmount = filtered.reduce((sum, row) => sum + row.normalAmount, 0);
    const otAmount = filtered.reduce((sum, row) => sum + row.otAmount, 0);
    const totalAmount = filtered.reduce((sum, row) => sum + row.totalAmount, 0);
    const absent = filtered.filter((row) => row.absent).length;
    return { people: people.size, normal, ot, normalAmount, otAmount, totalAmount, absent };
  }, [filtered]);

  const trendData = useMemo(() => buildTrend(filtered, applied, trend), [filtered, applied, trend]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const fromEntry = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const toEntry = Math.min(safePage * PAGE_SIZE, filtered.length);
  const hourTotal = totals.normal + totals.ot;
  const regularShare = hourTotal > 0 ? (totals.normal / hourTotal) * 100 : 0;
  const otShare = hourTotal > 0 ? (totals.ot / hourTotal) * 100 : 0;

  function applyFilters() {
    const next = { ...draft };
    if (next.from && next.to && next.from > next.to) {
      const swap = next.from;
      next.from = next.to;
      next.to = swap;
    }
    setDraft(next);
    setApplied(next);
    backfillTimesheetRates(side, companyId);
    setSheets(loadTimesheets());
    setPage(1);
    setReportKey((key) => key + 1);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href={base}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[#2563EB] transition-opacity hover:opacity-75"
          aria-label="Back"
        >
          <ArrowLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-[#2563EB]">Timesheet Report</h1>
      </div>
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(7.5rem,9rem)] xl:items-end">
          <FilterField label="Report Type" icon={<Clock className="h-4 w-4" />}>
            <Select value="summary">
              <SelectTrigger className="pl-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="summary">Timesheet Summary</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Date Range" icon={<CalendarDays className="h-4 w-4" />}>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-start pl-9 font-normal">
                  {slashDate(draft.from)} – {slashDate(draft.to)}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 space-y-3">
                <div className="space-y-1.5">
                  <Label>From</Label>
                  <SimpleDatePicker date={parseIso(draft.from)} setDate={(date) => date && setDraft((prev) => ({ ...prev, from: toIso(date) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>To</Label>
                  <SimpleDatePicker date={parseIso(draft.to)} setDate={(date) => date && setDraft((prev) => ({ ...prev, to: toIso(date) }))} />
                </div>
              </PopoverContent>
            </Popover>
          </FilterField>
          <FilterField label="Employee" icon={<Users className="h-4 w-4" />}>
            <Select value={draft.employee} onValueChange={(employee) => setDraft((prev) => ({ ...prev, employee }))}>
              <SelectTrigger className="pl-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {employeeOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Department">
            <Select value={draft.department} onValueChange={(department) => setDraft((prev) => ({ ...prev, department }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departmentOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label={partyLabel}>
            <Select value={draft.party} onValueChange={(party) => setDraft((prev) => ({ ...prev, party }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All {partyLabel}s</SelectItem>
                {partyOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
          <div className="flex min-w-0 items-end">
            <Button
              type="button"
              className="h-auto min-h-10 w-full gap-1 whitespace-normal bg-[#2563EB] px-2 py-1.5 text-center leading-tight hover:bg-[#1D4ED8]"
              onClick={applyFilters}
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="inline-flex flex-col items-center text-xs font-semibold sm:text-sm">
                <span>Generate</span>
                <span>Report</span>
              </span>
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard tone="blue" icon={<Users className="h-6 w-6" />} label="Total Employees" value={String(totals.people)} />
        <StatCard tone="green" icon={<Clock className="h-6 w-6" />} label="Normal Hours / Amount" value={`${hoursText(totals.normal)} hrs · SGD ${moneyText(totals.normalAmount)}`} />
        <StatCard tone="orange" icon={<CalendarDays className="h-6 w-6" />} label="OT Hours / Amount" value={`${hoursText(totals.ot)} hrs · SGD ${moneyText(totals.otAmount)}`} />
        <StatCard tone="purple" icon={<CalendarDays className="h-6 w-6" />} label="Total Hours / Amount" value={`${hoursText(totals.normal + totals.ot)} hrs · SGD ${moneyText(totals.totalAmount)}`} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.55fr_1fr]">
        <section key={reportKey} className="rounded-2xl border border-[#E6EDF5] bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-[#1E293B]">
              <BarChart3 className="h-4 w-4 text-[#2563EB]" /> Working Hours Trend
            </h2>
            <div className="inline-flex items-center gap-1">
              {(["weekly", "monthly", "custom"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`rounded-full px-3.5 py-1 text-xs font-medium capitalize ${trend === mode ? "bg-[#2563EB] text-white shadow-sm" : "bg-[#F3F4F6] text-[#64748B]"}`}
                  onClick={() => setTrend(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid vertical={false} stroke="#EEF2F6" />
                <XAxis dataKey="label" interval={0} tick={<TrendTick />} height={46} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  formatter={(value: number, name: string) => [hoursText(Number(value)), name === "regular" ? "Regular Hours" : "OT Hours"]}
                  labelStyle={{ color: "#334155", fontWeight: 600 }}
                  contentStyle={{ borderRadius: 10, borderColor: "#E6EDF5" }}
                />
                <Bar dataKey="regular" fill="#3B82F6" radius={[5, 5, 0, 0]} barSize={34} />
                <Line dataKey="ot" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 4, fill: "#F59E0B", stroke: "#fff", strokeWidth: 1 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex justify-center gap-6 text-xs text-[#64748B]">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#3B82F6]" /> Regular Hours</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]" /> OT Hours</span>
          </div>
        </section>

        <section className="rounded-2xl border border-[#E6EDF5] bg-white p-4 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-[#1E293B]">
            <PieChartIcon className="h-4 w-4 text-[#2563EB]" /> Hours Distribution
          </h2>
          {hourTotal === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-slate-400">No hours in this range</div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="relative h-64 min-w-0 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[{ name: "Regular", value: totals.normal }, { name: "OT", value: totals.ot }]} dataKey="value" innerRadius={72} outerRadius={98} startAngle={90} endAngle={-270} stroke="#fff" strokeWidth={3}>
                      <Cell fill="#2563EB" />
                      <Cell fill="#F59E0B" />
                    </Pie>
                    <Tooltip formatter={(value: number, name: string) => [`${hoursText(Number(value))} hrs`, name === "Regular" ? "Regular Hours" : "Overtime Hours"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-3xl font-bold text-[#1E293B]">{hoursText(totals.normal).replace(/\.00$/, "")}</div>
                  <div className="text-xs text-[#94A3B8]">Total Hours</div>
                </div>
              </div>
              <div className="w-40 shrink-0 space-y-3 text-sm text-[#475569]">
                <div className="flex items-start gap-2"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#2563EB]" /><span>Regular Hours ({regularShare.toFixed(1)}%)</span></div>
                <div className="flex items-start gap-2"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#F59E0B]" /><span>Overtime Hours ({otShare.toFixed(1)}%)</span></div>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#E6EDF5] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[#1E293B]">
            <ClipboardList className="h-4 w-4 text-[#2563EB]" /> Timesheet Details
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-9 gap-2 border-[#86EFAC] bg-white text-[#16A34A] hover:bg-[#F0FDF4]" onClick={() => exportExcel(filtered)}>
              <FileSpreadsheet className="h-4 w-4" /> Export Excel
            </Button>
            <Button type="button" variant="outline" className="h-9 gap-2 border-[#FCA5A5] bg-white text-[#EF4444] hover:bg-[#FEF2F2]" onClick={() => exportPdf(filtered)}>
              <FileText className="h-4 w-4" /> Export PDF
            </Button>
            <Button type="button" variant="outline" className="h-9 gap-2 border-[#93C5FD] bg-white text-[#2563EB] hover:bg-[#EFF6FF]" onClick={() => printReport(filtered)}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto px-3 pb-2">
          <table className="w-full min-w-[1360px] overflow-hidden rounded-lg text-sm">
            <thead>
              <tr className="bg-[#102A43] text-left text-white">
                {["#", "Employee Name", "Designation", "Department", "Date", "Check In", "Check Out", "Rate", "Normal Hours", "Normal Amt", "OT Hours", "OT Amt", "Total Hours", "Total Amt", "Status"].map((heading, index, headings) => (
                  <th key={heading} className={`bg-[#102A43] px-3 py-3 text-xs font-semibold ${index === 0 ? "rounded-l-lg" : ""} ${index === headings.length - 1 ? "rounded-r-lg" : ""}`}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-3 py-10 text-center text-slate-400">No timesheets in this range.</td>
                </tr>
              ) : pageRows.map((row, index) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-3 py-3 text-slate-500">{fromEntry + index}</td>
                  <td className="px-3 py-3 font-medium text-slate-800">{row.employeeName}</td>
                  <td className="px-3 py-3 text-slate-600">{row.designation}</td>
                  <td className="px-3 py-3 text-slate-600">{row.department}</td>
                  <td className="px-3 py-3 text-slate-600">{row.dateLabel}</td>
                  <td className="px-3 py-3 text-slate-600">{row.checkIn}</td>
                  <td className="px-3 py-3 text-slate-600">{row.checkOut}</td>
                  <td className="px-3 py-3 text-slate-600">{moneyText(row.rate)}</td>
                  <td className="px-3 py-3 text-slate-600">{hoursText(row.normal)}</td>
                  <td className="px-3 py-3 text-slate-600">{moneyText(row.normalAmount)}</td>
                  <td className="px-3 py-3 text-slate-600">{hoursText(row.ot)}</td>
                  <td className="px-3 py-3 text-slate-600">{moneyText(row.otAmount)}</td>
                  <td className="px-3 py-3 text-slate-600">{hoursText(row.total)}</td>
                  <td className="px-3 py-3 font-medium text-slate-800">{moneyText(row.totalAmount)}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClass(row.status)}`}>
                      {statusLabel(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-slate-500">
          <span>Showing {fromEntry} to {toEntry} of {filtered.length} entries</span>
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {pageButtons(safePage, pageCount).map((item, index) => (
              item === "…" ? (
                <span key={`gap-${index}`} className="px-1">…</span>
              ) : (
                <Button
                  key={item}
                  type="button"
                  variant="outline"
                  className={`h-8 w-8 px-0 ${item === safePage ? "border-[#BFDBFE] bg-[#DBEAFE] text-[#2563EB] hover:bg-[#DBEAFE]" : "text-[#64748B]"}`}
                  onClick={() => setPage(item)}
                >
                  {item}
                </Button>
              )
            ))}
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function FilterField({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-500">{label}</Label>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-400">{icon}</span>}
        {children}
      </div>
    </div>
  );
}

function StatCard({ tone, icon, label, value }: { tone: "blue" | "green" | "orange" | "purple"; icon: ReactNode; label: string; value: string }) {
  const tones = {
    blue: "border-[#D6E6FF] bg-[#EAF2FF] text-[#3B82F6]",
    green: "border-[#CFF3DF] bg-[#E8F8EE] text-[#22C55E]",
    orange: "border-[#FFE4C7] bg-[#FFF4E8] text-[#F59E0B]",
    purple: "border-[#E4D9FF] bg-[#F4EEFF] text-[#8B5CF6]",
  };
  return (
    <div className={`flex items-center gap-4 rounded-2xl border px-4 py-4 ${tones[tone]}`}>
      <div className="shrink-0">{icon}</div>
      <div>
        <div className="text-sm text-[#64748B]">{label}</div>
        <div className="text-[22px] font-bold leading-tight text-[#1E293B]">{value}</div>
      </div>
    </div>
  );
}

function TrendTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value?: string } }) {
  const [first, second] = String(payload?.value || "").split("\n");
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fill="#94A3B8" fontSize={11}>
        <tspan x={0} dy={12}>{first}</tspan>
        {second ? <tspan x={0} dy={14}>{second}</tspan> : null}
      </text>
    </g>
  );
}

function designationFromLabel(label: string) {
  const parts = label.split(/—|–/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function toReportRows(row: Timesheet, deployments: ReturnType<typeof loadDeployments>, employees: EmployeeRow[]): ReportRow[] {
  const deployment = resolveDeployment(row, deployments);
  const rate = parseRate(row.billingRate) || parseRate(deployment?.billingRate) || parseRate(deployment?.payRate);
  const otRate = parseRate(row.otBillingRate) || (rate > 0 ? rate * 1.5 : 0);

  const entryList = Array.isArray(row.entries) && row.entries.length > 0
    ? row.entries
    : [{
        id: row.id,
        employeeId: row.employeeId,
        employeeLabel: row.employeeLabel,
        workLocation: row.workLocation,
        workDate: row.workDate,
        timeIn: row.timeIn,
        timeOut: row.timeOut,
        breakHours: row.breakHours,
        normalHours: row.normalHours,
        overtimeHours: row.overtimeHours,
        dayType: row.dayType,
      }];

  return entryList.map((entry, index) => {
    const ids = String(entry.employeeId || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const employee = employees.find((item) =>
      ids.includes(String(item.id)) || (item.employeeId && ids.includes(String(item.employeeId))),
    );
    const normal = Number(entry.normalHours) || 0;
    const ot = Number(entry.overtimeHours) || 0;
    const normalAmount = Math.round(normal * rate * 100) / 100;
    const otAmount = Math.round(ot * otRate * 100) / 100;
    const totalAmount = Math.round((normalAmount + otAmount) * 100) / 100;
    const workDate = String(entry.workDate || row.workDate || "").slice(0, 10);
    return {
      id: `${row.id}-${entry.id || index}`,
      employeeName: employeeName(entry.employeeLabel || employee?.name || ""),
      designation: deployment?.designation || employee?.designation || designationFromLabel(entry.employeeLabel || "") || "—",
      department: employee?.department || "—",
      dateIso: workDate,
      dateLabel: slashDate(workDate),
      checkIn: clockLabel(entry.timeIn || row.timeIn),
      checkOut: clockLabel(entry.timeOut || row.timeOut),
      normal,
      ot,
      total: normal + ot,
      rate,
      otRate,
      normalAmount,
      otAmount,
      totalAmount,
      status: row.status,
      absent: String(entry.dayType || row.dayType || "").toLowerCase().includes("absent"),
      partyName: row.partyName || "—",
    };
  });
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function buildTrend(rows: ReportRow[], filters: Filters, mode: "weekly" | "monthly" | "custom") {
  const from = filters.from || monthStart();
  const to = filters.to || monthEnd();
  const dated = rows.map((row) => row.dateIso).filter((iso) => iso >= from && iso <= to).sort();
  const anchor = dated[0] || from;
  const buckets: { iso: string; label: string; regular: number; ot: number }[] = [];
  if (mode === "weekly") {
    const start = mondayOf(anchor);
    for (let index = 0; index < 7; index += 1) {
      const iso = addDays(start, index);
      const date = parseIso(iso);
      buckets.push({ iso, label: `${WEEKDAYS[index]}\n${pad(date.getDate())} ${date.toLocaleString("en-GB", { month: "short" })}`, regular: 0, ot: 0 });
    }
  } else if (mode === "monthly") {
    const start = parseIso(anchor);
    const month = new Date(start.getFullYear(), start.getMonth(), 1);
    for (let week = 0; week < 6; week += 1) {
      const date = new Date(month.getFullYear(), month.getMonth(), 1 + week * 7);
      if (date.getMonth() !== month.getMonth()) break;
      buckets.push({ iso: toIso(date), label: `Week ${week + 1}`, regular: 0, ot: 0 });
    }
  } else {
    const spanStart = dated[0] || from;
    const spanEnd = dated[dated.length - 1] || to;
    let cursor = spanStart;
    let guard = 0;
    while (cursor <= spanEnd && guard < 31) {
      const date = parseIso(cursor);
      buckets.push({ iso: cursor, label: `${pad(date.getDate())} ${date.toLocaleString("en-GB", { month: "short" })}`, regular: 0, ot: 0 });
      cursor = addDays(cursor, 1);
      guard += 1;
    }
  }
  for (const row of rows) {
    const bucket = mode === "weekly"
      ? buckets.find((item) => item.iso === row.dateIso)
      : buckets.find((item) => row.dateIso >= item.iso && row.dateIso <= addDays(item.iso, mode === "monthly" ? 6 : 0));
    if (!bucket) continue;
    bucket.regular += row.normal;
    bucket.ot += row.ot;
  }
  return buckets;
}

function exportRows(rows: ReportRow[]) {
  return rows.map((row, index) => ({
    "#": index + 1,
    "Employee Name": row.employeeName,
    Designation: row.designation,
    Department: row.department,
    Date: row.dateLabel,
    "Check In": row.checkIn,
    "Check Out": row.checkOut,
    Rate: moneyText(row.rate),
    "Normal Hours": hoursText(row.normal),
    "OT Hours": hoursText(row.ot),
    "Total Hours": hoursText(row.total),
    Status: statusLabel(row.status),
  }));
}

function exportExcel(rows: ReportRow[]) {
  const sheet = XLSX.utils.json_to_sheet(exportRows(rows));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Timesheet");
  XLSX.writeFile(book, "timesheet-report.xlsx");
}

function exportPdf(rows: ReportRow[]) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text("Timesheet Summary", 14, 16);
  const data = exportRows(rows);
  autoTable(doc, {
    startY: 22,
    head: [Object.keys(data[0] ?? { "#": "", "Employee Name": "", Designation: "", Department: "", Date: "", "Check In": "", "Check Out": "", Rate: "", "Normal Hours": "", "Normal Amount": "", "OT Hours": "", "OT Amount": "", "Total Hours": "", "Total Amount": "", Status: "" })],
    body: data.map((row) => Object.values(row)),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [22, 50, 79] },
  });
  doc.save("timesheet-report.pdf");
}

function printReport(rows: ReportRow[]) {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  const body = exportRows(rows).map((row) => `<tr>${Object.values(row).map((value) => `<td>${value}</td>`).join("")}</tr>`).join("");
  const head = ["#", "Employee Name", "Designation", "Department", "Date", "Check In", "Check Out", "Rate", "Normal Hours", "Normal Amount", "OT Hours", "OT Amount", "Total Hours", "Total Amount", "Status"]
    .map((heading) => `<th>${heading}</th>`).join("");
  win.document.write(`<!doctype html><html><head><title>Timesheet Summary</title><style>body{font-family:Arial,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px;text-align:left}th{background:#16324F;color:#fff}</style></head><body><h2>Timesheet Summary</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function pageButtons(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const points = [1, total, current - 1, current, current + 1].filter((page) => page >= 1 && page <= total);
  const sorted = [...new Set(points)].sort((a, b) => a - b);
  const result: Array<number | "…"> = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("…");
    result.push(page);
  });
  return result;
}
