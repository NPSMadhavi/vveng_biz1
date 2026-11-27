import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { Download, Loader2, Package, Users, ChevronDown, ChevronUp, ChevronRight, FileText, Building2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateBalanceSheet_PDF } from "@/lib/pdf";
import type { Asset } from "@shared/schema";
import { AccountActivityPanel } from "@/pages/accounting/account-activity";
import { payrollAmount, payrollEmployeeId, payrollEmployeeName, payrollEmployeeSubtitle, payrollPeriodLabel } from "@/pages/accounting/payroll-record-fields";
import { useFollowWorkingYear } from "@/components/financial-year-controls";


interface AcctLine { code: string; name: string; subType: string | null; amount: number }
interface BSData {
  asOf: string;
  isIndia?: boolean;
  assets: AcctLine[]; totalAssets: number;
  liabilities: AcctLine[]; totalLiabilities: number;
  equity: AcctLine[]; retainedEarnings: number; totalEquity: number;
  totalLiabilitiesAndEquity: number;
  balanced: boolean;
  difference?: number;
  unreconciledOpeningOffset?: number;
  reconciliationWarning?: string | null;
}

function fmtAmt(n: number, normalSide?: "Dr" | "Cr") {
  const abs = Math.abs(n);
  const s = new Intl.NumberFormat("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs);
  if (abs < 0.005) return "0.00";
  if (normalSide === "Cr") return n < 0 ? `${s} Dr` : `${s} Cr`;
  return n < 0 ? `${s} Cr` : `${s} Dr`;
}
function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-SG", { day: "2-digit", month: "long", year: "numeric" });
}

function initialBsState() {
  const today = new Date().toISOString().split("T")[0];
  const currentYear = new Date().getFullYear();
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const asOf = params.get("asOf") || today;
  const year = Number(params.get("year") || asOf.slice(0, 4)) || currentYear;
  const quarterRaw = params.get("quarter");
  const quarter = quarterRaw === null || quarterRaw === "" ? null : Number(quarterRaw);
  return {
    asOf,
    year: Number.isFinite(year) ? year : currentYear,
    quarter: quarter !== null && quarter >= 0 && quarter <= 3 ? quarter : null,
    expand: params.get("expand") || "",
  };
}

function bsReturnPath(asOf: string, year: number, quarter: number | null, expand: string) {
  const q = new URLSearchParams();
  if (asOf) q.set("asOf", asOf);
  if (year) q.set("year", String(year));
  if (quarter !== null) q.set("quarter", String(quarter));
  if (expand) q.set("expand", expand);
  return `/accounting/balance-sheet?${q.toString()}`;
}

// Quarter end dates (calendar year)
const QUARTER_ENDS = [
  { label: "Q1", month: "03", day: "31" },
  { label: "Q2", month: "06", day: "30" },
  { label: "Q3", month: "09", day: "30" },
  { label: "Q4", month: "12", day: "31" },
];

function GroupLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 bg-gray-50 border-b border-gray-100">
      <div className="w-0.5 h-4 bg-gray-300 rounded-full" />
      <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</span>
    </div>
  );
}

interface SectionProps {
  groupLabel?: string;
  rows: AcctLine[];
  subtotalLabel: string;
  subtotal: number;
  isGrandTotal?: boolean;
  normalSide?: "Dr" | "Cr";
  expandedRows?: Record<string, boolean>;
  onToggleRow?: (row: AcctLine) => void;
  isRowClickable?: (row: AcctLine) => boolean;
  renderExpandedRow?: (row: AcctLine) => React.ReactNode;
  groupAction?: React.ReactNode;
}

function Section({
  groupLabel,
  rows,
  subtotalLabel,
  subtotal,
  isGrandTotal,
  normalSide = "Dr",
  expandedRows = {},
  onToggleRow,
  isRowClickable,
  renderExpandedRow,
  groupAction,
}: SectionProps) {
  const active = rows.filter(r => Math.abs(r.amount) > 0.005);
  return (
    <>
      {groupLabel && (
        <div className="flex items-center justify-between px-5 py-2.5 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-0.5 h-4 bg-gray-300 rounded-full" />
            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{groupLabel}</span>
          </div>
          {groupAction}
        </div>
      )}
      {active.map(r => {
        const isClickable = Boolean(isRowClickable && isRowClickable(r));
        const isExpanded = Boolean(expandedRows[r.code]);
        return (
          <div key={r.code} className="border-b border-gray-100 transition-all">
            <div
              onClick={() => {
                if (isClickable && onToggleRow) onToggleRow(r);
              }}
              className={cn(
                "flex items-baseline justify-between px-5 py-2",
                isClickable ? "cursor-pointer hover:bg-blue-50/70 transition-colors group" : "hover:bg-gray-50/60"
              )}
            >
              <span className="flex items-baseline gap-3 text-sm text-gray-600">
                <span className="font-mono text-xs text-gray-400 w-10 shrink-0">{r.code}</span>
                <span className={cn(isClickable && "group-hover:text-blue-700 font-medium")}>{r.name}</span>
                {isClickable && (
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 text-gray-400 group-hover:text-blue-600 transition-transform duration-200",
                      isExpanded && "rotate-180 text-blue-600"
                    )}
                  />
                )}
              </span>
              <span className="font-mono text-sm tabular-nums ml-6 shrink-0 text-gray-800">{fmtAmt(r.amount, normalSide)}</span>
            </div>
            {isExpanded && renderExpandedRow && (
              <div className="bg-slate-50/80 p-3 border-t border-gray-200 animate-in fade-in duration-200">
                {renderExpandedRow(r)}
              </div>
            )}
          </div>
        );
      })}
      {active.length === 0 && <div className="px-5 py-3 text-xs text-gray-300 italic pl-[4.5rem]">No entries</div>}
      <div className={cn("flex items-baseline justify-between px-5 py-3", isGrandTotal ? "bg-gray-900 text-white" : "bg-gray-50 border-t border-gray-200")}>
        <span className={cn("text-xs font-bold uppercase tracking-wider", isGrandTotal ? "text-gray-300" : "text-gray-500")}>{subtotalLabel}</span>
        <span className={cn("font-mono tabular-nums shrink-0 ml-6", isGrandTotal ? "text-white text-base font-bold" : "text-gray-900 text-sm font-semibold")}>
          {fmtAmt(subtotal, normalSide)}
        </span>
      </div>
    </>
  );
}

function SubtotalBar({ label, amount, normalSide = "Dr" }: { label: string; amount: number; normalSide?: "Dr" | "Cr" }) {
  return (
    <div className="flex items-baseline justify-between px-5 py-2.5 bg-gray-100 border-t-2 border-gray-200">
      <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums ml-6 text-gray-900">{fmtAmt(amount, normalSide)}</span>
    </div>
  );
}

export default function BalanceSheetPage() {
  const { selectedCompany } = useAuth();
  const [, setLocation] = useLocation();
  const today = new Date().toISOString().split("T")[0];
  const currentYear = new Date().getFullYear();
  const [boot] = useState(initialBsState);

  const [asOf, setAsOf] = useState(boot.asOf);
  const [selYear, setSelYear] = useState(boot.year);
  const urlLocked = useRef(new URLSearchParams(window.location.search).has("asOf"));
  useFollowWorkingYear(urlLocked.current, (_from, nextTo) => {
    setAsOf(nextTo);
    setSelYear(Number(nextTo.slice(0, 4)) || new Date().getFullYear());
    setSelQuarter(null);
  });
  const [selQuarter, setSelQuarter] = useState<number | null>(boot.quarter);
  const [pdfLoading, setPdfLoading] = useState(false);

  function sheetReturn(expand: string) {
    return bsReturnPath(asOf, selYear, selQuarter, expand);
  }

  function openFromSheet(path: string, expand: string) {
    const join = path.includes("?") ? "&" : "?";
    setLocation(`${path}${join}returnTo=${encodeURIComponent(sheetReturn(expand))}`);
  }

  function selectQuarter(qi: number, year: number) {
    const q = QUARTER_ENDS[qi];
    const d = `${year}-${q.month}-${q.day}`;
    setAsOf(d);
    setSelYear(year);
    setSelQuarter(qi);
  }

  function handleDateChange(val: string) {
    setAsOf(val);
    setSelQuarter(null); // switch to custom
  }

  const { data, isLoading, isError, error } = useQuery<BSData>({
    queryKey: ["balance-sheet", asOf],
    queryFn: async () => {
      const r = await fetch(`/api/balance-sheet?asOf=${asOf}`, { credentials: "include" });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Failed to load"); }
      return r.json();
    },
    staleTime: 30_000,
  });

  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>(
    boot.expand ? { [boot.expand]: true } : {},
  );
  const toggleRow = (code: string) => {
    setExpandedRows(prev => ({
      ...prev,
      [code]: !prev[code],
    }));
  };

  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ["/api/assets"],
  });

  const { data: payrollRecords = [] } = useQuery<any[]>({
    queryKey: ["/api/payroll/records"],
  });

  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ["/api/employees"],
  });

  const { data: vendorInvoices = [] } = useQuery<any[]>({
    queryKey: ["/api/vendor-invoices"],
    queryFn: async () => {
      const res = await fetch("/api/vendor-invoices", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: expenses = [] } = useQuery<any[]>({
    queryKey: ["expenses"],
    queryFn: async () => {
      const res = await fetch("/api/expenses", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const assetBreakdown = useMemo(() => {
    return assets.map((a) => {
      const cost = parseFloat(String((a as any).cost || 0)) || 0;
      const marker = `asset-payment:${a.id}`;
      const paid = expenses.reduce((sum, exp) => {
        if (exp.notes?.includes(marker)) {
          return sum + (Number(exp.amount) || 0);
        }
        return sum;
      }, 0);
      return {
        asset: a,
        cost,
        paid,
        balance: Math.max(0, cost - paid),
      };
    });
  }, [assets, expenses]);

  const salariesBreakdown = useMemo(() => {
    return payrollRecords.map((rec: any) => {
      const emp = employees.find((e: any) => Number(e.id) === Number(payrollEmployeeId(rec)));
      const gross = payrollAmount(rec, "grossPay", "gross_pay");
      const net = payrollAmount(rec, "netPay", "net_pay");
      const empId = payrollEmployeeId(rec);
      const paid = expenses.reduce((sum, exp) => {
        const isSalaryMarker = exp.notes?.includes(`payroll-payment:salary:${empId}:`);
        const isLegacySalary =
          exp.notes?.includes(`payroll-payment:${empId}:`) &&
          !exp.notes?.includes("payroll-payment:cpf:") &&
          !exp.notes?.includes("Type: CPF") &&
          !exp.notes?.includes("payment-type:cpf") &&
          !exp.description?.toLowerCase().includes("cpf");
        if (isSalaryMarker || isLegacySalary) {
          return sum + (Number(exp.amount) || 0);
        }
        return sum;
      }, 0);
      return {
        record: rec,
        employee: emp,
        gross,
        net,
        paid,
        balance: Math.max(0, Math.round((net - paid) * 100) / 100),
      };
    });
  }, [payrollRecords, employees, expenses]);

  const cpfBreakdown = useMemo(() => {
    return payrollRecords.map((rec: any) => {
      const emp = employees.find((e: any) => Number(e.id) === Number(payrollEmployeeId(rec)));
      const employeeCpf = payrollAmount(rec, "cpfDeduction", "cpfEmployee", "cpf_employee");
      const employerCpf = payrollAmount(rec, "cpfEmployer", "cpf_employer");
      const totalCpf = Math.round((employeeCpf + employerCpf) * 100) / 100 || employeeCpf;
      const empId = payrollEmployeeId(rec);
      const paid = expenses.reduce((sum, exp) => {
        const isCpfMarker = exp.notes?.includes(`payroll-payment:cpf:${empId}:`);
        const isLegacyCpf =
          exp.notes?.includes(`payroll-payment:${empId}:`) &&
          (exp.notes?.includes("Type: CPF") ||
            exp.notes?.includes("payment-type:cpf") ||
            exp.description?.toLowerCase().includes("cpf"));
        if (isCpfMarker || isLegacyCpf) {
          return sum + (Number(exp.amount) || 0);
        }
        return sum;
      }, 0);
      return {
        record: rec,
        employee: emp,
        employeeCpf,
        employerCpf,
        totalCpf,
        paid,
        balance: Math.max(0, Math.round((totalCpf - paid) * 100) / 100),
      };
    });
  }, [payrollRecords, employees, expenses]);

  const payrollBreakdown = salariesBreakdown;

  const isNonCurrentOrFixed = (a: AcctLine) =>
    a.subType === "non_current_asset" ||
    a.subType === "fixed_asset" ||
    a.code.startsWith("15") ||
    a.code.startsWith("16") ||
    a.code.startsWith("17") ||
    /fixed asset|equipment|furniture|renovation/i.test(a.name);

  const ncAssets  = data?.assets.filter(isNonCurrentOrFixed) ?? [];
  const curAssets = data?.assets.filter(a => !isNonCurrentOrFixed(a)) ?? [];
  const curLiab   = data?.liabilities.filter(a => a.subType !== "non_current_liability") ?? [];
  const ncLiab    = data?.liabilities.filter(a => a.subType === "non_current_liability") ?? [];
  const grandTotalAssets = data
    ? parseFloat(Number(data.totalAssets).toFixed(2))
    : 0;
  const grandTotalLiabEq = data
    ? parseFloat(Number(data.totalLiabilitiesAndEquity).toFixed(2))
    : 0;

  async function handleDownloadPDF() {
    if (!data) return;
    setPdfLoading(true);
    try {
      await generateBalanceSheet_PDF(
        selectedCompany as any, asOf,
        data.assets, grandTotalAssets,
        data.liabilities, data.totalLiabilities,
        data.equity, data.retainedEarnings, data.totalEquity,
        grandTotalLiabEq, data.balanced
      );
    } finally {
      setPdfLoading(false);
    }
  }

  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-5 pb-20 animate-in fade-in duration-300">
      <div className="flex items-end justify-between flex-wrap gap-4 pb-4 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-bold text-[#2563EB]">Balance Sheet</h1>
        </div>
        <div className="flex items-end gap-4 flex-wrap">
          {data && (
            <span className={cn("text-xs font-semibold px-2.5 py-1 rounded border mb-0.5", data.balanced ? "border-green-200 text-green-700 bg-green-50" : "border-red-200 text-red-700 bg-red-50")}>
              {data.balanced ? "Balanced ✓" : "Out of balance"}
            </span>
          )}
          {data && (
            <Button variant="outline" size="sm" onClick={handleDownloadPDF} disabled={pdfLoading} className="border-gray-200 text-gray-600 hover:text-gray-900 mb-0.5">
              {pdfLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Download PDF
            </Button>
          )}
        </div>
      </div>

      {/* Date / quarter selector */}
      <div className="flex flex-wrap items-end gap-4 p-4 bg-muted/20 border rounded-lg">
        {/* Year */}
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Year</Label>
          <select
            value={selYear}
            onChange={e => {
              const y = parseInt(e.target.value);
              setSelYear(y);
              if (selQuarter !== null) selectQuarter(selQuarter, y);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* Quarter buttons */}
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Quarter end</Label>
          <div className="flex gap-1.5">
            {QUARTER_ENDS.map((q, i) => (
              <button
                key={q.label}
                onClick={() => selectQuarter(i, selYear)}
                className={cn(
                  "h-8 px-3 text-xs font-semibold rounded-md border transition-colors",
                  selQuarter === i
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-input text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                {q.label}
                <span className="ml-1 font-normal opacity-60">
                  {new Date(`${selYear}-${q.month}-${q.day}T00:00:00`).toLocaleDateString("en-SG", { month: "short", day: "numeric" })}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Custom date */}
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Or custom date</Label>
          <Input
            type="date"
            value={asOf}
            max={today}
            onChange={e => handleDateChange(e.target.value)}
            className="w-40 text-sm h-8 border-gray-200"
          />
        </div>
      </div>

      {data && (!data.balanced || data.reconciliationWarning) && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Opening Balance Reconciliation Warning</p>
            <p className="text-xs text-amber-900">
              {data.reconciliationWarning ||
                `Assets (${fmtAmt(grandTotalAssets)}) do not equal Equity & Liabilities (${fmtAmt(grandTotalLiabEq)}). Difference: ${fmtAmt(data.difference ?? (grandTotalAssets - grandTotalLiabEq))}.`}
            </p>
          </div>
        </div>
      )}

      {isLoading && <div className="text-center py-16 text-sm text-gray-400">Loading…</div>}
      {isError   && <div className="text-center py-16 text-sm text-red-500">{(error as Error).message}</div>}

      {data && (
        <>
          <p className="text-xs text-gray-400">As at {fmtDate(data.asOf)} · All amounts in SGD · Accounts with zero balance are hidden.</p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden flex flex-col h-full min-h-0">
              <div className="px-5 py-3 border-b border-gray-200 bg-white shrink-0">
                <h2 className="text-sm font-bold uppercase tracking-widest text-gray-800">Assets</h2>
              </div>
              <div className="flex-1 flex flex-col min-h-0">
              <Section
                groupLabel="Non-Current Assets (Fixed Assets)"
                rows={ncAssets}
                subtotalLabel="Total Non-Current Assets"
                subtotal={ncAssets.reduce((s, a) => s + a.amount, 0)}
                expandedRows={expandedRows}
                onToggleRow={(r) => toggleRow(r.code)}
                isRowClickable={() => true}
                renderExpandedRow={(r) => (
                  <AccountActivityPanel accountCode={r.code} from={`${selYear}-01-01`} to={asOf} returnTo={sheetReturn(r.code)} />
                )}
                groupAction={
                  assetBreakdown.length > 0 && ncAssets.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        const code = ncAssets[0]?.code;
                        if (code) toggleRow(code);
                      }}
                      className="text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                    >
                      <Package className="h-3.5 w-3.5" />
                      {ncAssets.some(r => expandedRows[r.code]) ? "Hide Fixed Assets" : `View All Fixed Assets (${assetBreakdown.length})`}
                    </button>
                  ) : undefined
                }
              />
              <Section
                groupLabel="Current Assets"
                rows={curAssets}
                subtotalLabel="Total Current Assets"
                subtotal={curAssets.reduce((s, a) => s + a.amount, 0)}
                expandedRows={expandedRows}
                onToggleRow={(r) => toggleRow(r.code)}
                isRowClickable={() => true}
                renderExpandedRow={(r) => <AccountActivityPanel accountCode={r.code} from={`${selYear}-01-01`} to={asOf} returnTo={sheetReturn(r.code)} />}
              />
              </div>
              <div className="mt-auto shrink-0 flex items-baseline justify-between px-5 py-3 bg-gray-900">
                <span className="text-xs font-bold uppercase tracking-widest text-gray-300">Total Assets</span>
                <span className="font-mono text-base font-bold text-white tabular-nums ml-6">{fmtAmt(grandTotalAssets)}</span>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden flex flex-col h-full min-h-0">
              <div className="px-5 py-3 border-b border-gray-200 bg-white shrink-0">
                <h2 className="text-sm font-bold uppercase tracking-widest text-gray-800">Equity &amp; Liabilities</h2>
              </div>
              <div className="flex-1 flex flex-col min-h-0">
              <Section
                groupLabel="Current Liabilities"
                normalSide="Cr"
                rows={curLiab}
                subtotalLabel="Total Current Liabilities"
                subtotal={curLiab.reduce((s, a) => s + a.amount, 0)}
                expandedRows={expandedRows}
                onToggleRow={(r) => toggleRow(r.code)}
                isRowClickable={() => true}
                renderExpandedRow={(r) => (
                  <AccountActivityPanel accountCode={r.code} from={`${selYear}-01-01`} to={asOf} returnTo={sheetReturn(r.code)} />
                )}
                groupAction={
                  <div className="flex items-center gap-2">
                    {salariesBreakdown.length > 0 && curLiab.some(r => r.code === "2040" || /salaries payable|staff salaries/i.test(r.name)) && (
                      <button
                        type="button"
                        onClick={() => {
                          const prRow = curLiab.find(r => r.code === "2040" || /salaries payable|staff salaries/i.test(r.name));
                          if (prRow) toggleRow(prRow.code);
                        }}
                        className="text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                      >
                        <Users className="h-3.5 w-3.5" />
                        {curLiab.some(r => (r.code === "2040" || /salaries payable|staff salaries/i.test(r.name)) && expandedRows[r.code])
                          ? "Hide Salaries"
                          : `View Salaries (${salariesBreakdown.length})`}
                      </button>
                    )}
                    {cpfBreakdown.length > 0 && curLiab.some(r => r.code === "2050" || /cpf contributions payable|cpf payable/i.test(r.name)) && (
                      <button
                        type="button"
                        onClick={() => {
                          const cpfRow = curLiab.find(r => r.code === "2050" || /cpf contributions payable|cpf payable/i.test(r.name));
                          if (cpfRow) toggleRow(cpfRow.code);
                        }}
                        className="text-[11px] font-medium text-emerald-600 hover:text-emerald-800 hover:underline flex items-center gap-1"
                      >
                        <Building2 className="h-3.5 w-3.5" />
                        {curLiab.some(r => (r.code === "2050" || /cpf contributions payable|cpf payable/i.test(r.name)) && expandedRows[r.code])
                          ? "Hide CPF"
                          : `View CPF (${cpfBreakdown.length})`}
                      </button>
                    )}
                  </div>
                }
              />
              <Section
                groupLabel="Non-Current Liabilities"
                normalSide="Cr"
                rows={ncLiab}
                subtotalLabel="Total Non-Current Liabilities"
                subtotal={ncLiab.reduce((s, a) => s + a.amount, 0)}
                expandedRows={expandedRows}
                onToggleRow={(r) => toggleRow(r.code)}
                isRowClickable={() => true}
                renderExpandedRow={(r) => <AccountActivityPanel accountCode={r.code} from={`${selYear}-01-01`} to={asOf} returnTo={sheetReturn(r.code)} />}
              />
              <SubtotalBar label="Total Liabilities" amount={data.totalLiabilities} normalSide="Cr" />

              <GroupLabel label="Equity" />
              {data.equity.filter(e => Math.abs(e.amount) > 0.005).map(e => {
                const open = Boolean(expandedRows[e.code]);
                const isBroughtForwardRe = e.code === "3100" || /retained earnings/i.test(e.name);
                return (
                  <div key={e.code} className="border-b border-gray-100">
                    <div
                      className={cn("flex items-baseline justify-between px-5 py-2 cursor-pointer hover:bg-blue-50/70", open && "bg-blue-50/40")}
                      onClick={() => toggleRow(e.code)}
                    >
                      <span className="flex items-baseline gap-3 text-sm text-gray-600">
                        <span className="font-mono text-xs text-gray-400 w-10 shrink-0">{e.code}</span>
                        <span className={cn(open && "text-blue-700 font-medium")}>
                          {isBroughtForwardRe ? "Retained Earnings (Brought Forward)" : e.name}
                        </span>
                        <ChevronDown className={cn("h-3.5 w-3.5 text-gray-400 transition-transform", open && "rotate-180 text-blue-600")} />
                      </span>
                      <span className="font-mono text-sm tabular-nums ml-6 shrink-0 text-gray-800">{fmtAmt(e.amount, "Cr")}</span>
                    </div>
                    {open && (
                      <div className="bg-slate-50/80 border-t border-gray-200">
                        <AccountActivityPanel accountCode={e.code} from={`${selYear}-01-01`} to={asOf} returnTo={sheetReturn(e.code)} />
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="flex items-baseline justify-between px-5 py-2 border-b border-gray-100 hover:bg-gray-50/60">
                <span className="flex items-baseline gap-3 text-sm text-gray-600">
                  <span className="w-10 shrink-0" />
                  <span>
                    Profit/(Loss) for the Period
                    <span className="ml-2 text-[11px] italic text-gray-400">from Profit &amp; Loss</span>
                  </span>
                </span>
                <span className="font-mono text-sm tabular-nums ml-6 shrink-0 text-gray-800">{fmtAmt(data.retainedEarnings, "Cr")}</span>
              </div>
              <SubtotalBar label="Total Equity" amount={data.totalEquity} normalSide="Cr" />
              </div>

              <div className="mt-auto shrink-0 flex items-baseline justify-between px-5 py-3 bg-gray-900">
                <span className="text-xs font-bold uppercase tracking-widest text-gray-300">Total Equity &amp; Liabilities</span>
                <span className="font-mono text-base font-bold tabular-nums ml-6 text-white">{fmtAmt(grandTotalLiabEq, "Cr")}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}