import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useListInvoices, getListInvoicesQueryKey,
  useListPurchaseOrders, getListPurchaseOrdersQueryKey,
  useListQuotations, getListQuotationsQueryKey,
  useListDeliveryOrders, getListDeliveryOrdersQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  FileText,
  Receipt,
  ShoppingCart,
  CreditCard,
  Package,
  RotateCcw,
  AlertCircle,
  Clock,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { fmtDate } from "@/lib/utils";
import { DateRangeFilter } from "@/components/date-range-filter";
import { CloseFyStartNextWizard, usePeriodReadOnly } from "@/components/financial-year-controls";
import {
  useDateRangeOptional,
  type FinancialYearSummary,
} from "@/contexts/date-range-context";
import { PERIOD_PRESETS, fmtRangeLabel, inRange } from "@/lib/date-range";
import { Button } from "@/components/ui/button";

async function fetchJsonList(path: string): Promise<any[]> {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }));
    const msg =
      typeof body?.error === "string" && body.error.trim()
        ? body.error
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json() as Promise<any[]>;
}

const money = (v: number) =>
  new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    maximumFractionDigits: 0,
  }).format(v || 0);

const moneyExact = (v: number) =>
  new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 2,
  }).format(v || 0);

function invoiceBalance(inv: { totalAmount?: string | number; paidAmount?: string | number; balance?: string | number }) {
  if (inv.balance != null && inv.balance !== "") {
    return Math.max(0, parseFloat(String(inv.balance)) || 0);
  }
  const total = parseFloat(String(inv.totalAmount)) || 0;
  const paid = parseFloat(String(inv.paidAmount)) || 0;
  return Math.max(0, total - paid);
}

function isOpenReceivable(status: string | null | undefined) {
  return !["paid", "void", "cancelled", "draft"].includes(String(status || ""));
}

function vendorOutstanding(vi: { totalAmount?: string | number; paidAmount?: string | number; status?: string }) {
  if (vi.status === "paid") return 0;
  const total = parseFloat(String(vi.totalAmount)) || 0;
  const paid = parseFloat(String(vi.paidAmount)) || 0;
  return Math.max(0, total - paid);
}

function formatAxisTick(v: number) {
  if (v <= 0) return "0";
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (v >= 1000) {
    const k = v / 1000;
    return `${Number.isInteger(k) ? k : Math.round(k * 10) / 10}k`;
  }
  return String(Math.round(v));
}

function niceChartMax(rawMax: number) {
  if (rawMax <= 0) return 160;
  const padded = rawMax * 1.15;
  const mag = Math.pow(10, Math.floor(Math.log10(padded)));
  const norm = padded / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 4 ? 4 : norm <= 5 ? 5 : 8;
  return nice * mag;
}

function buildSmoothPath(
  points: Array<{ x: number; y: number }>,
  yMin: number,
  yMax: number,
) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const clampY = (y: number) => Math.min(yMax, Math.max(yMin, y));
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = clampY(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function LineChart({
  incomeValues,
  expenseValues,
  labels,
}: {
  incomeValues: number[];
  expenseValues: number[];
  labels: string[];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const padL = 44;
  const padR = 16;
  const padT = 12;
  const padB = 30;
  const width = 640;
  const height = 280;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const baselineY = padT + plotH;
  const n = Math.max(incomeValues.length, expenseValues.length, labels.length, 2);
  const rawMax = Math.max(...incomeValues, ...expenseValues, 0);
  const maxVal = niceChartMax(rawMax);
  const ticks = [0, 1, 2, 3, 4].map((i) => (maxVal * (4 - i)) / 4);

  const toPoint = (values: number[]) =>
    Array.from({ length: n }, (_, i) => {
      const v = Math.max(0, values[i] ?? 0);
      const x = padL + (i / Math.max(n - 1, 1)) * plotW;
      const y = baselineY - (v / maxVal) * plotH;
      return { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
    });

  const incomePts = toPoint(incomeValues);
  const expensePts = toPoint(expenseValues);
  const incomePath = buildSmoothPath(incomePts, padT, baselineY);
  const expensePath = buildSmoothPath(expensePts, padT, baselineY);
  const lastIncome = incomePts[incomePts.length - 1];
  const areaD = incomePts.length
    ? `${incomePath} L ${lastIncome.x} ${baselineY} L ${incomePts[0].x} ${baselineY} Z`
    : "";

  const activeIdx = hoverIdx ?? incomePts.length - 1;
  const activeIncome = incomePts[activeIdx];
  const activeExpense = expensePts[activeIdx];
  const tipW = 128;
  const tipH = 62;
  const tipX = activeIncome
    ? Math.min(Math.max(activeIncome.x - tipW / 2, padL), width - padR - tipW)
    : padL;
  const tipY = activeIncome
    ? Math.max(padT, Math.min(activeIncome.y, activeExpense?.y ?? activeIncome.y) - tipH - 12)
    : padT;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    if (x < padL || x > width - padR) {
      setHoverIdx(null);
      return;
    }
    const t = (x - padL) / plotW;
    const idx = Math.round(t * Math.max(n - 1, 1));
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-full min-h-[280px] w-full cursor-crosshair"
      preserveAspectRatio="none"
      role="img"
      aria-label="Income vs expense chart"
      onMouseMove={onMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <defs>
        <linearGradient id="incomeAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2B7BE8" stopOpacity="0.42" />
          <stop offset="40%" stopColor="#2B7BE8" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#2B7BE8" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {ticks.map((tick, i) => {
        const y = padT + (i / 4) * plotH;
        return (
          <g key={`tick-${i}`}>
            <line
              x1={padL}
              y1={y}
              x2={width - padR}
              y2={y}
              stroke="#D7E0F0"
              strokeWidth="1"
              strokeDasharray="4 6"
            />
            <text
              x={padL - 10}
              y={y + 3.5}
              textAnchor="end"
              fill="#8B9BB4"
              fontSize="11"
            >
              {formatAxisTick(tick)}
            </text>
          </g>
        );
      })}

      <line x1={padL} y1={padT} x2={padL} y2={baselineY} stroke="#B8C5DB" strokeWidth="1.5" />
      <line x1={padL} y1={baselineY} x2={width - padR} y2={baselineY} stroke="#B8C5DB" strokeWidth="1.5" />

      {areaD ? <path d={areaD} fill="url(#incomeAreaGrad)" /> : null}

      {/* Expense (#1E3A8A) under Income (#2B7BE8) — both visible like reference */}
      <path
        d={expensePath}
        fill="none"
        stroke="#1E3A8A"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={incomePath}
        fill="none"
        stroke="#2B7BE8"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {lastIncome && hoverIdx === null ? (
        <>
          {expensePts[expensePts.length - 1] ? (
            <circle
              cx={expensePts[expensePts.length - 1].x}
              cy={expensePts[expensePts.length - 1].y}
              r="4.5"
              fill="#FFFFFF"
              stroke="#1E3A8A"
              strokeWidth="2.25"
            />
          ) : null}
          <circle
            cx={lastIncome.x}
            cy={lastIncome.y}
            r="6.5"
            fill="#FFFFFF"
            stroke="#2B7BE8"
            strokeWidth="3"
          />
        </>
      ) : null}

      {labels.map((label, i) => {
        const x = padL + (i / Math.max(n - 1, 1)) * plotW;
        return (
          <g key={`${label}-${i}`}>
            <line
              x1={x}
              y1={baselineY}
              x2={x}
              y2={baselineY + 5}
              stroke="#B8C5DB"
              strokeWidth="1.5"
            />
            <text
              x={x}
              y={height - 6}
              fill="#8B9BB4"
              fontSize="11"
              textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
            >
              {label}
            </text>
          </g>
        );
      })}

      {hoverIdx !== null && activeIncome && activeExpense ? (
        <g pointerEvents="none">
          <line
            x1={activeIncome.x}
            y1={padT}
            x2={activeIncome.x}
            y2={baselineY}
            stroke="#94A3B8"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
          <circle cx={activeIncome.x} cy={activeIncome.y} r="6" fill="#FFFFFF" stroke="#2B7BE8" strokeWidth="3" />
          <circle cx={activeExpense.x} cy={activeExpense.y} r="5.5" fill="#FFFFFF" stroke="#1E3A8A" strokeWidth="2.5" />
          <rect
            x={tipX}
            y={tipY}
            width={tipW}
            height={tipH}
            rx="10"
            fill="#0F1C33"
            opacity="0.92"
          />
          <text x={tipX + 12} y={tipY + 18} fill="#E2E8F0" fontSize="10" fontWeight="600">
            {labels[hoverIdx] ?? ""}
          </text>
          <circle cx={tipX + 16} cy={tipY + 34} r="3.5" fill="#2B7BE8" />
          <text x={tipX + 24} y={tipY + 37} fill="#FFFFFF" fontSize="11">
            {money(incomeValues[hoverIdx] ?? 0)}
          </text>
          <circle cx={tipX + 16} cy={tipY + 52} r="3.5" fill="#1E3A8A" />
          <text x={tipX + 24} y={tipY + 55} fill="#FFFFFF" fontSize="11">
            {money(expenseValues[hoverIdx] ?? 0)}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

export default function Dashboard() {
  const { user, hasModuleAccess, selectedCompany } = useAuth();
  const { readOnly: fyReadOnly } = usePeriodReadOnly();
  const companyId = selectedCompany?.id ?? null;
  // Generated User schema exposes username; some sessions may also carry fullName.
  const userName =
    String((user as { fullName?: string | null } | null)?.fullName || user?.username || "there").trim() ||
    "there";

  const {
    periodPreset,
    rangeFrom,
    rangeTo,
    rangeFromStr,
    rangeToStr,
    applyDateRange,
    applyThisYear,
    applyFinancialYear,
    reconcileAgainstFinancialYears,
  } = useDateRangeOptional();
  const [fyRolloverRequest, setFyRolloverRequest] = useState<{ from: string; to: string } | null>(null);
  const [selectedCard, setSelectedCard] = useState("Total Income");
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const cardHighlightStyle: CSSProperties = {
    background: "linear-gradient(135deg, #2F4FC4 0%, #2B7BE8 100%)",
  };

  const periodChipLabel = PERIOD_PRESETS.find((p) => p.id === periodPreset)?.label ?? "Custom Range";
  const periodLabel = fmtRangeLabel(rangeFrom, rangeTo);

  const fyQuery = useQuery({
    queryKey: ["financial-years", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const res = await fetch("/api/financial-years", { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(
          typeof body?.error === "string" && body.error.trim()
            ? body.error
            : `Financial years request failed (${res.status})`,
        );
      }
      return res.json() as Promise<{
        years: FinancialYearSummary[];
        active: FinancialYearSummary | null;
      }>;
    },
    retry: false,
  });

  const activeFy = fyQuery.data?.active?.status === "active" ? fyQuery.data.active : null;
  const selectedFy = (fyQuery.data?.years || []).find(
    (year) => !!year.id && year.startDate >= rangeFromStr && year.startDate <= rangeToStr,
  );
  const openingQuery = useQuery({
    queryKey: ["fy-opening-summary", companyId, selectedFy?.id ?? null],
    enabled: !!companyId && !!selectedFy?.id,
    queryFn: async () => {
      const res = await fetch(`/api/financial-years/${selectedFy!.id}/opening-summary`, { credentials: "include" });
      if (!res.ok) return { receivables: 0, payables: 0, generated: false };
      return res.json() as Promise<{ receivables: number; payables: number; generated: boolean }>;
    },
  });
  const carriedReceivable = Number(openingQuery.data?.receivables) || 0;
  const carriedPayable = Number(openingQuery.data?.payables) || 0;

  useEffect(() => {
    if (!fyQuery.data?.years) return;
    reconcileAgainstFinancialYears(fyQuery.data.years, fyQuery.data.active ?? null);
  }, [fyQuery.data, reconcileAgainstFinancialYears]);

  const invoicesEnabled = hasModuleAccess("invoices") && !!companyId;
  const purchaseOrdersEnabled = hasModuleAccess("purchase_orders") && !!companyId;
  const quotationsEnabled = hasModuleAccess("quotations") && !!companyId;
  const deliveryOrdersEnabled = hasModuleAccess("delivery_orders") && !!companyId;
  const expensesEnabled = hasModuleAccess("accounting_expenses") && !!companyId;
  const incomeEnabled = hasModuleAccess("accounting_income") && !!companyId;
  const vendorInvoicesEnabled = hasModuleAccess("vendor_invoices") && !!companyId;
  const stockEnabled = hasModuleAccess("stock_items") && !!companyId;

  const { data: invoices = [] } = useListInvoices({
    query: {
      queryKey: [...getListInvoicesQueryKey(), companyId],
      enabled: invoicesEnabled,
    },
  });
  const { data: purchaseOrders = [] } = useListPurchaseOrders({
    query: {
      queryKey: [...getListPurchaseOrdersQueryKey(), companyId],
      enabled: purchaseOrdersEnabled,
    },
  });
  const { data: quotations = [] } = useListQuotations({
    query: {
      queryKey: [...getListQuotationsQueryKey(), companyId],
      enabled: quotationsEnabled,
    },
  });
  const { data: deliveryOrders = [] } = useListDeliveryOrders({
    query: {
      queryKey: [...getListDeliveryOrdersQueryKey(), companyId],
      enabled: deliveryOrdersEnabled,
    },
  });

  const expensesQuery = useQuery({
    queryKey: ["dashboard-expenses", companyId],
    enabled: expensesEnabled,
    queryFn: () => fetchJsonList("/api/expenses"),
    retry: false,
  });
  const incomeQuery = useQuery({
    queryKey: ["dashboard-income", companyId],
    enabled: incomeEnabled,
    queryFn: () => fetchJsonList("/api/income"),
    retry: false,
  });
  const stockQuery = useQuery({
    queryKey: ["stock-items-dashboard", companyId],
    enabled: stockEnabled,
    queryFn: () => fetchJsonList("/api/stock-items"),
    retry: false,
  });
  const vendorInvoicesQuery = useQuery({
    queryKey: ["dashboard-vendor-invoices", companyId],
    enabled: vendorInvoicesEnabled,
    queryFn: () => fetchJsonList("/api/vendor-invoices"),
    retry: false,
  });

  const expenses = expensesQuery.data ?? [];
  const incomeRecords = incomeQuery.data ?? [];
  const stockItems = stockQuery.data ?? [];
  const vendorInvoices = vendorInvoicesQuery.data ?? [];

  const metrics = useMemo(() => {
    const invList = (invoices as any[]) || [];
    const expList = (expenses as any[]) || [];
    const incomeList = (incomeRecords as any[]) || [];
    const poList = (purchaseOrders as any[]) || [];
    const viList = (vendorInvoices as any[]) || [];

    const monthInvoices = invList.filter((i) =>
      inRange(i.issueDate || i.createdAt, new Date(rangeFrom), new Date(rangeTo)),
    );
    const monthExpenses = expList.filter((e) =>
      inRange(e.expenseDate || e.createdAt, new Date(rangeFrom), new Date(rangeTo)),
    );
    const monthVendorInvoices = viList.filter((vi) =>
      inRange(vi.piDate || vi.createdAt, new Date(rangeFrom), new Date(rangeTo)),
    );
    const monthIncomeExtra = incomeList.filter((r) =>
      inRange(r.incomeDate || r.createdAt, new Date(rangeFrom), new Date(rangeTo)),
    );
    const monthPurchaseOrders = poList.filter((po) =>
      inRange(po.issueDate || po.createdAt, new Date(rangeFrom), new Date(rangeTo)),
    );

    const invoiceIncome = monthInvoices
      .filter((i) => i.status !== "void" && i.status !== "cancelled" && i.status !== "draft")
      .reduce((s, i) => s + (parseFloat(i.totalAmount) || 0), 0);
    const otherIncome = monthIncomeExtra
      .filter((r) => r.status !== "void")
      .reduce((s, r) => s + (parseFloat(r.amount ?? r.totalAmount) || 0), 0);
    const totalIncome = invoiceIncome + otherIncome;

    const totalExpenses =
      monthExpenses
        .filter((e) => e.status !== "void")
        .reduce((s, e) => s + (parseFloat(e.amount ?? e.totalAmount) || 0), 0)
      + monthVendorInvoices
        .filter((vi) => vi.status !== "void" && vi.status !== "cancelled" && vi.status !== "draft")
        .reduce((s, vi) => s + (parseFloat(String(vi.totalAmount)) || 0), 0);

    const netProfit = totalIncome - totalExpenses;

    const receivable = monthInvoices
      .filter((i) => isOpenReceivable(i.status))
      .reduce((s, i) => s + invoiceBalance(i), 0);

    const overdueReceivable = monthInvoices
      .filter((i) => {
        if (!isOpenReceivable(i.status)) return false;
        const due = i.deliveryDate || i.dueDate;
        if (!due) return i.status === "overdue";
        return new Date(due) < new Date(new Date().toISOString().slice(0, 10));
      })
      .reduce((s, i) => s + invoiceBalance(i), 0);

    const payable = monthVendorInvoices
      .reduce((s, vi) => s + vendorOutstanding(vi), 0);

    // Split selected range into 5 buckets for the overview chart
    const spanMs = Math.max(rangeTo.getTime() - rangeFrom.getTime(), 24 * 60 * 60 * 1000);
    const bucketCount = 5;
    const bucketMs = spanMs / bucketCount;
    const weeks = Array.from({ length: bucketCount }, (_, w) => {
      const start = new Date(rangeFrom.getTime() + w * bucketMs);
      const end = new Date(Math.min(rangeFrom.getTime() + (w + 1) * bucketMs - 1, rangeTo.getTime()));
      const inc =
        invList
          .filter((i) => inRange(i.issueDate || i.createdAt, start, end))
          .filter((i) => i.status !== "void" && i.status !== "cancelled" && i.status !== "draft")
          .reduce((s, i) => s + (parseFloat(i.totalAmount) || 0), 0)
        + incomeList
          .filter((r) => inRange(r.incomeDate || r.createdAt, start, end))
          .filter((r) => r.status !== "void")
          .reduce((s, r) => s + (parseFloat(r.amount ?? r.totalAmount) || 0), 0);
      const exp =
        expList
          .filter((e) => inRange(e.expenseDate || e.createdAt, start, end))
          .filter((e) => e.status !== "void")
          .reduce((s, e) => s + (parseFloat(e.amount ?? e.totalAmount) || 0), 0)
        + viList
          .filter((vi) => inRange(vi.piDate || vi.createdAt, start, end))
          .filter((vi) => vi.status !== "void" && vi.status !== "cancelled" && vi.status !== "draft")
          .reduce((s, vi) => s + (parseFloat(String(vi.totalAmount)) || 0), 0);
      return { inc, exp, start, end };
    });

    const sales = invoiceIncome;
    const services = otherIncome;
    const discounts = monthInvoices.reduce((s, i) => s + (parseFloat(i.discountAmount) || 0), 0);
    const categoryTotal = sales + services + discounts || 1;
    const incomeCategories = [
      { label: "Sales", value: money(sales), pct: `${((sales / categoryTotal) * 100).toFixed(1)}%`, color: "#1a73e8", raw: sales },
      { label: "Other Income", value: money(services), pct: `${((services / categoryTotal) * 100).toFixed(1)}%`, color: "#16a34a", raw: services },
      { label: "Discounts", value: money(discounts), pct: `${((discounts / categoryTotal) * 100).toFixed(1)}%`, color: "#f59e0b", raw: discounts },
    ].filter((c) => c.raw > 0 || categoryTotal === 1);

    // If no category data, keep India-like placeholders so donut still renders
    const cats = incomeCategories.length
      ? incomeCategories
      : [
          { label: "Sales", value: money(0), pct: "0%", color: "#1a73e8", raw: 0 },
          { label: "Other Income", value: money(0), pct: "0%", color: "#16a34a", raw: 0 },
          { label: "Discounts", value: money(0), pct: "0%", color: "#f59e0b", raw: 0 },
        ];

    let offset = 0;
    const donutSegments = cats.map((c) => {
      const pct = categoryTotal > 0 ? (c.raw / categoryTotal) * 100 : 0;
      const seg = { pct: Math.max(pct, 0), color: c.color, offset };
      offset += pct;
      return seg;
    });

    const chartLabels = weeks.map((w, i) =>
      (i === weeks.length - 1 ? rangeTo : w.start).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      }),
    );
    const incomeValues = weeks.map((w) => w.inc);
    const expenseValues = weeks.map((w) => w.exp);

    const overdueCount = monthInvoices.filter((i) => {
      if (["paid", "void", "cancelled", "draft"].includes(String(i.status))) return false;
      const due = i.deliveryDate || i.dueDate;
      if (!due) return i.status === "overdue";
      return new Date(due) < new Date(new Date().toISOString().slice(0, 10));
    }).length;

    const draftCount = monthInvoices.filter((i) => i.status === "draft").length;
    const lowStock = (stockItems as any[]).filter((i) => Number(i.stockQty) <= 5).length;

    // Recent transactions mix
    const txns: {
      date: string;
      type: string;
      typeCode: string;
      typeColor: string;
      number: string;
      party: string;
      amount: string;
      status: string;
      statusColor: string;
      href: string;
      sort: number;
    }[] = [];

    for (const inv of monthInvoices.slice(0, 20)) {
      const status = String(inv.status || "draft");
      const statusColor =
        status === "paid" ? "bg-[#dcfce7] text-[#16a34a]"
        : status === "confirmed" || status === "sent" ? "bg-[#dbeafe] text-[#1a73e8]"
        : status === "overdue" ? "bg-[#fee2e2] text-[#dc2626]"
        : status === "draft" ? "bg-[#ffedd5] text-[#ea580c]"
        : "bg-[#f1f5f9] text-[#64748b]";
      txns.push({
        date: fmtDate(inv.issueDate || inv.createdAt) || "—",
        type: "Invoice",
        typeCode: "I",
        typeColor: "bg-[#dbeafe] text-[#1a73e8]",
        number: inv.invNumber,
        party: inv.customerName,
        amount: moneyExact(parseFloat(inv.totalAmount) || 0),
        status: status.charAt(0).toUpperCase() + status.slice(1),
        statusColor,
        href: `/invoices/${inv.id}`,
        sort: new Date(inv.issueDate || inv.createdAt || 0).getTime(),
      });
    }
    for (const exp of monthExpenses.slice(0, 10)) {
      txns.push({
        date: fmtDate(exp.expenseDate || exp.createdAt) || "—",
        type: "Expense",
        typeCode: "E",
        typeColor: "bg-[#fee2e2] text-[#dc2626]",
        number: exp.reference || `EXP-${exp.id}`,
        party: exp.vendorName || exp.payee || "Expense",
        amount: moneyExact(parseFloat(exp.amount ?? exp.totalAmount) || 0),
        status: String(exp.status || "Recorded").charAt(0).toUpperCase() + String(exp.status || "recorded").slice(1),
        statusColor: "bg-[#dcfce7] text-[#16a34a]",
        href: `/accounting/expenses/${exp.id}`,
        sort: new Date(exp.expenseDate || exp.createdAt || 0).getTime(),
      });
    }
    for (const po of monthPurchaseOrders.slice(0, 10)) {
      txns.push({
        date: fmtDate(po.issueDate || po.createdAt) || "—",
        type: "Purchase",
        typeCode: "P",
        typeColor: "bg-[#fee2e2] text-[#dc2626]",
        number: po.poNumber,
        party: po.vendorName,
        amount: moneyExact(parseFloat(String(po.totalAmount)) || 0),
        status: String(po.status || "draft").charAt(0).toUpperCase() + String(po.status || "draft").slice(1),
        statusColor:
          po.status === "confirmed" ? "bg-[#dcfce7] text-[#16a34a]"
          : po.status === "draft" ? "bg-[#ffedd5] text-[#ea580c]"
          : "bg-[#f1f5f9] text-[#64748b]",
        href: `/purchase-orders/${po.id}`,
        sort: new Date(po.issueDate || po.createdAt || 0).getTime(),
      });
    }
    txns.sort((a, b) => b.sort - a.sort);

    const hasSourceActivity =
      invList.length > 0 ||
      expList.length > 0 ||
      incomeList.length > 0 ||
      viList.length > 0 ||
      poList.length > 0;
    const hasPeriodActivity =
      monthInvoices.length > 0 ||
      monthExpenses.length > 0 ||
      monthIncomeExtra.length > 0 ||
      monthVendorInvoices.length > 0;

    return {
      totalIncome,
      totalExpenses,
      netProfit,
      receivable,
      overdueReceivable,
      payable,
      cats,
      donutSegments,
      incomeValues,
      expenseValues,
      chartLabels: chartLabels.slice(0, 5),
      overdueCount,
      overdueAmount: overdueReceivable,
      draftCount,
      lowStock,
      transactions: txns.slice(0, 5),
      hasSourceActivity,
      hasPeriodActivity,
    };
  }, [invoices, expenses, incomeRecords, purchaseOrders, vendorInvoices, stockItems, rangeFrom, rangeTo]);

  const showEmptyPeriodBanner =
    metrics.hasSourceActivity && !metrics.hasPeriodActivity;
  const carriedForward = carriedReceivable > 0 || carriedPayable > 0;
  const rangeIsActiveYear =
    !!activeFy && rangeFromStr === activeFy.startDate && rangeToStr === activeFy.endDate;
  const summaryCards = [
    {
      title: "Total Income",
      value: money(metrics.totalIncome),
      icon: TrendingUp,
    },
    {
      title: "Total Expenses",
      value: money(metrics.totalExpenses),
      icon: TrendingDown,
    },
    {
      title: "Net Profit",
      value: money(metrics.netProfit),
      icon: DollarSign,
    },
    {
      title: "Outstanding Receivable",
      value: money(metrics.receivable + carriedReceivable),
      icon: ArrowUpRight,
    },
    {
      title: "Outstanding Payable",
      value: money(metrics.payable + carriedPayable),
      icon: ArrowDownRight,
    },
  ];

  const recentPurchaseOrders = ((purchaseOrders as any[]) || [])
    .slice()
    .sort((a, b) => new Date(b.issueDate || b.createdAt || 0).getTime() - new Date(a.issueDate || a.createdAt || 0).getTime())
    .slice(0, 5)
    .map((po) => ({
      id: po.id,
      number: po.poNumber || "—",
      party: po.vendorName || "—",
      amount: money(parseFloat(String(po.totalAmount)) || 0),
      href: `/purchase-orders/${po.id}`,
    }));

  const recentQuotations = ((quotations as any[]) || [])
    .slice()
    .sort((a, b) => new Date(b.issueDate || b.createdAt || 0).getTime() - new Date(a.issueDate || a.createdAt || 0).getTime())
    .slice(0, 5)
    .map((qt) => ({
      id: qt.id,
      number: qt.qtNumber || "—",
      party: qt.customerName || "—",
      amount: money(parseFloat(String(qt.totalAmount)) || 0),
      href: `/quotations/${qt.id}`,
    }));

  const recentInvoices = ((invoices as any[]) || [])
    .slice()
    .sort((a, b) => new Date(b.issueDate || b.createdAt || 0).getTime() - new Date(a.issueDate || a.createdAt || 0).getTime())
    .slice(0, 5)
    .map((inv) => ({
      id: inv.id,
      number: inv.invNumber || "—",
      party: inv.customerName || "—",
      amount: money(parseFloat(String(inv.totalAmount)) || 0),
      href: `/invoices/${inv.id}`,
    }));

  const recentDeliveryOrders = ((deliveryOrders as any[]) || [])
    .slice()
    .sort((a, b) => new Date(b.issueDate || b.createdAt || 0).getTime() - new Date(a.issueDate || a.createdAt || 0).getTime())
    .slice(0, 5)
    .map((d) => ({
      id: d.id,
      number: d.doNumber || "—",
      party: d.customerName || "—",
      status: String(d.status || "draft"),
      href: `/delivery-orders/${d.id}`,
    }));

  const activityPanels = [
    {
      title: "Purchase Orders",
      href: "/purchase-orders",
      headerClass: "bg-[#2B7BE8]",
      show: purchaseOrdersEnabled,
      cols: ["Invoice", "Customers", "Amount"] as const,
      rows: recentPurchaseOrders.map((r) => ({
        key: String(r.id),
        href: r.href,
        cells: [r.number, r.party, r.amount] as const,
        status: null as string | null,
      })),
    },
    {
      title: "Quotations",
      href: "/quotations",
      headerClass: "bg-[#3B82F6]",
      show: quotationsEnabled,
      cols: ["Invoice", "Customers", "Amount"] as const,
      rows: recentQuotations.map((r) => ({
        key: String(r.id),
        href: r.href,
        cells: [r.number, r.party, r.amount] as const,
        status: null as string | null,
      })),
    },
    {
      title: "Invoices",
      href: "/invoices",
      headerClass: "bg-[#1E3A8A]",
      show: invoicesEnabled,
      cols: ["Invoice", "Customers", "Amount"] as const,
      rows: recentInvoices.map((r) => ({
        key: String(r.id),
        href: r.href,
        cells: [r.number, r.party, r.amount] as const,
        status: null as string | null,
      })),
    },
    {
      title: "Delivery Orders",
      href: "/delivery-orders",
      headerClass: "bg-[#1E40AF]",
      show: deliveryOrdersEnabled,
      cols: ["Invoice", "Customers", "Status"] as const,
      rows: recentDeliveryOrders.map((r) => ({
        key: String(r.id),
        href: r.href,
        cells: [r.number, r.party, ""] as const,
        status: r.status,
      })),
    },
  ].filter((p) => p.show);

  const quickActions = [
    { label: "New Invoice", icon: FileText, bg: "bg-[#DBEAFE]", color: "text-[#2563EB]", href: "/invoices/new", module: "invoices" as const },
    { label: "New Receipt", icon: Receipt, bg: "bg-[#DCFCE7]", color: "text-[#16A34A]", href: "/accounting/income/new", module: "accounting_income" as const },
    { label: "New Purchase Order", icon: ShoppingCart, bg: "bg-[#FFEDD5]", color: "text-[#EA580C]", href: "/purchase-orders/new", module: "purchase_orders" as const },
    { label: "New Payment", icon: CreditCard, bg: "bg-[#F3E8FF]", color: "text-[#9333EA]", href: "/accounting/expenses/new", module: "accounting_expenses" as const },
    { label: "New Product", icon: Package, bg: "bg-[#CCFBF1]", color: "text-[#0D9488]", href: "/stock", module: "stock_items" as const },
    { label: "New Credit Note", icon: RotateCcw, bg: "bg-[#FEE2E2]", color: "text-[#DC2626]", href: "/credit-notes/new", module: "credit_notes" as const },
  ].filter((action) =>
    fyReadOnly ? false : hasModuleAccess(action.module),
  );

  const lowStockCount = metrics.lowStock;
  const reminders = [
    {
      title: `${lowStockCount} Low Stock Item${lowStockCount === 1 ? "" : "s"}`,
      amount: "≤ 5 units",
      icon: Package,
      href: "/stock",
      kind: "low_stock" as const,
      show: true,
    },
    {
      title: `${metrics.overdueCount} Invoice${metrics.overdueCount === 1 ? "" : "s"} Overdue`,
      amount: money(metrics.overdueAmount),
      icon: AlertCircle,
      href: "/invoices",
      kind: "other" as const,
      show: hasModuleAccess("invoices") && metrics.overdueCount > 0,
    },
    {
      title: `${metrics.draftCount} Draft Invoice${metrics.draftCount === 1 ? "" : "s"}`,
      amount: "Needs review",
      icon: Clock,
      href: "/invoices",
      kind: "other" as const,
      show: hasModuleAccess("invoices") && metrics.draftCount > 0,
    },
  ].filter((r) => r.show);

  return (
    <div className="space-y-6 pb-8">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-bold tracking-tight text-[#2F4FC4]">
            Dashboard
          </h1>
          <p className="mt-1 text-[14px] text-[#64748b]">
            Welcome back, {userName}!
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DateRangeFilter
            preset={periodPreset}
            rangeFrom={rangeFrom}
            rangeTo={rangeTo}
            onApply={applyDateRange}
            showCloseFyButton
            onCloseFyClick={(from, to) => setFyRolloverRequest({ from, to })}
          />
        </div>
      </div>

      <CloseFyStartNextWizard
        openRequest={fyRolloverRequest}
        onOpenRequestHandled={() => setFyRolloverRequest(null)}
      />

      {showEmptyPeriodBanner && (
        <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
          <p className="font-semibold">
            {carriedForward ? "New year — balances carried forward" : "No activity in the selected period"}
          </p>
          <p className="mt-1 text-[13px]">
            {carriedForward
              ? `${periodLabel} has no new income or expense documents. Income, expenses, and profit start at zero. Outstanding receivable and payable include balances carried forward from the previous year.`
              : `${periodLabel} has no income or expense documents in this range. Income, expenses, outstanding balances, and recent transactions follow the selected dates.`}
          </p>
          {!rangeIsActiveYear && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-[#f59e0b] bg-white text-[#92400e] hover:bg-[#fff7ed]"
                onClick={() => applyThisYear()}
              >
                Use This Year
              </Button>
              {activeFy && (
                <Button
                  type="button"
                  size="sm"
                  className="bg-[#2F4FC4] text-white hover:bg-[#2540a8]"
                  onClick={() => applyFinancialYear(activeFy)}
                >
                  Use Active FY{activeFy.label ? ` (${activeFy.label})` : ""}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary Cards — equal size, full-width row; blue on hover/click */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          const highlighted = hoveredCard
            ? hoveredCard === card.title
            : selectedCard === card.title;
          return (
            <button
              type="button"
              key={card.title}
              onClick={() => setSelectedCard(card.title)}
              onMouseEnter={() => setHoveredCard(card.title)}
              onMouseLeave={() => setHoveredCard(null)}
              onFocus={() => setHoveredCard(card.title)}
              onBlur={() => setHoveredCard(null)}
              className={`flex h-[128px] w-full min-w-0 flex-col justify-between rounded-[16px] p-5 text-left shadow-[0_4px_16px_rgba(47,79,196,0.08)] transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-[#2B7BE8]/40 ${
                highlighted
                  ? "border border-transparent text-white"
                  : "border border-[#e4ebf7] bg-white text-[#0F1C33]"
              }`}
              style={highlighted ? cardHighlightStyle : undefined}
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full ${
                  highlighted ? "bg-white/20" : "bg-[#E8F1FC]"
                }`}
              >
                <Icon size={18} className={highlighted ? "text-white" : "text-[#2F4FC4]"} />
              </div>
              <div className="min-w-0">
                <p
                  className={`mb-1 truncate text-[13px] font-medium ${
                    highlighted ? "text-white/90" : "text-[#64748b]"
                  }`}
                  title={card.title}
                >
                  {card.title}
                </p>
                <p
                  className={`truncate text-[26px] font-bold leading-none tracking-tight ${
                    highlighted ? "text-white" : "text-[#0F1C33]"
                  }`}
                  title={card.value}
                >
                  {card.value}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Charts + Reminders + Quick Actions */}
      <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-12">
        <div className="flex min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-[28px] border border-[#E2E9F5] bg-white p-5 shadow-[0_8px_24px_rgba(47,79,196,0.08)] xl:col-span-7">
          <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <h2 className="text-[20px] font-bold tracking-tight text-[#0F1C33]">
              Income vs Expense Overview
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 text-[12px] text-[#6B7C99]">
                <span className="h-2 w-2 rounded-full bg-[#2B7BE8]" />
                Income
              </span>
              <span className="flex items-center gap-1.5 text-[12px] text-[#6B7C99]">
                <span className="h-2 w-2 rounded-full bg-[#1E3A8A]" />
                Expense
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF3FB] px-2.5 py-1 text-[11px] font-semibold text-[#2F4FC4]">
                {periodChipLabel}
                <ChevronDown size={12} className="opacity-70" />
              </span>
            </div>
          </div>

          <div className="mb-3 flex shrink-0 flex-wrap gap-2.5">
            <div className="min-w-[140px] max-w-[200px] flex-1 rounded-2xl border border-[#DCE5F5] bg-[#F4F7FC] px-3.5 py-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#2B7BE8]" />
                <span className="text-[12px] font-medium text-[#6B7C99]">Income</span>
              </div>
              <p className="text-[18px] font-bold leading-none tracking-tight text-[#0F1C33]">
                {money(metrics.totalIncome)}
              </p>
            </div>
            <div className="min-w-[140px] max-w-[200px] flex-1 rounded-2xl border border-[#DCE5F5] bg-[#F4F7FC] px-3.5 py-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#1E3A8A]" />
                <span className="text-[12px] font-medium text-[#6B7C99]">Expense</span>
              </div>
              <p className="text-[18px] font-bold leading-none tracking-tight text-[#0F1C33]">
                {money(metrics.totalExpenses)}
              </p>
            </div>
          </div>

          <div className="mt-auto min-h-[280px] flex-1">
            <LineChart
              incomeValues={metrics.incomeValues}
              expenseValues={metrics.expenseValues}
              labels={metrics.chartLabels}
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
          <div className="rounded-[20px] border border-[#e4ebf7] bg-white p-5 shadow-[0_4px_16px_rgba(47,79,196,0.06)]">
            <h2 className="mb-3 text-[15px] font-semibold text-[#0F1C33]">Reminders</h2>
            <div className="space-y-3">
              {reminders.map((item) => {
                const Icon = item.icon;
                const isLowStock = item.kind === "low_stock";
                return (
                  <div
                    key={item.title}
                    className="flex items-center gap-3 rounded-xl border border-[#eef2f8] bg-white p-3"
                  >
                    {isLowStock ? (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#E8EEF9] p-[3px]">
                        <div className="flex h-full w-full items-center justify-center rounded-full bg-[#1E3A8A]">
                          <Icon size={16} className="text-white" strokeWidth={2} />
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FEE2E2]">
                        <Icon size={16} className="text-[#DC2626]" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[#0F1C33]">{item.title}</p>
                      <p className="text-[11px] text-[#64748b]">{item.amount}</p>
                    </div>
                    <Link
                      href={item.href}
                      className="shrink-0 rounded-lg bg-[#2B7BE8] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#2569c7]"
                    >
                      View All
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-[20px] border border-[#e4ebf7] bg-white p-5 shadow-[0_4px_16px_rgba(47,79,196,0.06)]">
            <h2 className="mb-4 text-[15px] font-semibold text-[#0F1C33]">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-3">
              {quickActions.length === 0 ? (
                <p className="col-span-full text-[12px] text-[#94a3b8]">No actions for your assigned modules.</p>
              ) : quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.label}
                    href={action.href}
                    className="flex flex-col items-center gap-2 rounded-xl border border-[#e8edf5] bg-[#F5F7FB] px-3 py-4 transition hover:border-[#dce5f5] hover:shadow-sm"
                  >
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${action.bg}`}>
                      <Icon size={18} className={action.color} />
                    </div>
                    <span className="text-center text-[13px] font-semibold text-[#334155]">
                      {action.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Activity tables — 2×2 */}
      {activityPanels.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {activityPanels.map((panel) => (
            <div
              key={panel.title}
              className="overflow-hidden rounded-2xl border border-[#e4ebf7] bg-white shadow-[0_4px_16px_rgba(47,79,196,0.06)]"
            >
              <div className={`flex items-center justify-between px-4 py-3 text-white ${panel.headerClass}`}>
                <h2 className="text-[14px] font-semibold">{panel.title}</h2>
                <Link href={panel.href} className="inline-flex items-center gap-1 text-[12px] font-medium text-white/95 hover:text-white">
                  All <ArrowRight size={14} />
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[320px] text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-[#eef2f8] text-[#94a3b8]">
                      {panel.cols.map((col) => (
                        <th key={col} className="px-4 py-2.5 font-medium">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {panel.rows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-[#94a3b8]">
                          No records yet.
                        </td>
                      </tr>
                    ) : (
                      panel.rows.map((row) => (
                        <tr key={row.key} className="border-b border-[#f5f7fb] last:border-0">
                          <td className="px-4 py-3 font-medium text-[#0F1C33]">
                            <Link href={row.href} className="hover:text-[#2B7BE8] hover:underline">
                              {row.cells[0]}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-[#64748b]">{row.cells[1]}</td>
                          <td className="px-4 py-3 font-semibold text-[#0F1C33]">
                            {row.status ? (
                              <span className="inline-flex rounded-full bg-[#dcfce7] px-2.5 py-0.5 text-[10px] font-semibold uppercase text-[#16a34a]">
                                {row.status === "confirmed" || row.status === "delivered" ? "OK" : row.status}
                              </span>
                            ) : (
                              row.cells[2]
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
