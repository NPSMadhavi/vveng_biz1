import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, isValid } from "date-fns";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import type { Asset } from "@shared/schema";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { SyncBridgeDatePicker } from "@/components/ui/sync-bridge-date-picker";
import {
  calcAssetBookValues,
  formatAssetRegisterId,
} from "@/operations-8june/lib/asset-depreciation";
import { resolveAssetImageSrc } from "@/operations-8june/lib/asset-attachments";
import { cn } from "@/lib/utils";
import {
  Search, RotateCcw, Printer, FileText, Eye,
  Clock, Info, Trash2, Coins, TrendingDown, TrendingUp,
} from "lucide-react";

export type DisposalRowItem = {
  id: number;
  asset?: Asset;
  assetName: string;
  category: string;
  purchaseDate: string | null;
  disposalDate: string | null;
  cost: number;
  accDep: number;
  nbv: number;
  saleAmount: number;
  gainLoss: number;
  disposalType: string;
  disposalTypeKey: string;
  imageUrl?: string;
};

const DISPOSAL_TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "sale", label: "Sale" },
  { value: "scrap", label: "Scrapped" },
  { value: "write_off", label: "Damaged" },
  { value: "donation", label: "Donation / Gift" },
] as const;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function format2Dec(n: number) {
  return new Intl.NumberFormat("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatIntCurrency(n: number) {
  const rounded = Math.round(n);
  return `S$ ${new Intl.NumberFormat("en-SG").format(rounded)}`;
}

function formatDmy(dateStr?: string | null): string {
  if (!dateStr) return "—";
  try {
    const raw = dateStr.slice(0, 10);
    const parts = raw.split("-");
    if (parts.length === 3 && parts[0].length === 4) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    const d = parseISO(dateStr);
    if (isValid(d)) return format(d, "dd/MM/yyyy");
    return dateStr;
  } catch {
    return dateStr;
  }
}

function parseMoneyFromDesc(desc: string, label: string): number | null {
  const re = new RegExp(`${label}:\\s*S\\$\\s*([\\d,]+(?:\\.\\d+)?)`, "i");
  const m = desc.match(re);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeDisposalType(raw: string | null | undefined, description?: string | null) {
  const fromCol = String(raw || "").toLowerCase().trim();
  if (fromCol) {
    if (fromCol.includes("sale")) return "sale";
    if (fromCol.includes("scrap")) return "scrap";
    if (fromCol.includes("write") || fromCol.includes("damage")) return "write_off";
    if (fromCol.includes("donat")) return "donation";
    return fromCol;
  }
  const desc = String(description || "").toLowerCase();
  if (desc.includes("type: sale")) return "sale";
  if (desc.includes("type: scrap")) return "scrap";
  if (desc.includes("type: write")) return "write_off";
  if (desc.includes("type: donat")) return "donation";
  return "sale";
}

function disposalTypeLabel(key: string) {
  switch (key) {
    case "sale": return "Sale";
    case "scrap": return "Scrapped";
    case "write_off": return "Damaged";
    case "donation": return "Donation / Gift";
    default: return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function disposalTypeBadgeClass(key: string) {
  switch (key) {
    case "sale":
      return "bg-[#DBEAFE] text-[#1D4ED8]";
    case "scrap":
      return "bg-[#FFEDD5] text-[#C2410C]";
    case "write_off":
      return "bg-[#EDE9FE] text-[#6D28D9]";
    case "donation":
      return "bg-[#DCFCE7] text-[#15803D]";
    default:
      return "bg-[#F1F5F9] text-[#475569]";
  }
}

function toIsoDay(value?: string | Date | null): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const s = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  if (Number.isNaN(value.getTime())) return null;
  return format(value, "yyyy-MM-dd");
}

function buildDisposalRowFromAsset(asset: Asset): DisposalRowItem {
  const disposalDate =
    toIsoDay((asset as any).disposalDate || (asset as any).disposal_date) ||
    (() => {
      const desc = String((asset as any).description || "");
      const m = desc.match(/Disposed on (\d{4}-\d{2}-\d{2})/i);
      return m?.[1] || null;
    })();

  const asOf = disposalDate ? new Date(`${disposalDate}T00:00:00`) : new Date();
  const books = calcAssetBookValues(asset, asOf);
  const desc = String((asset as any).description || "");
  const saleFromDesc = parseMoneyFromDesc(desc, "Sale amount");
  const saleAmount = saleFromDesc != null ? saleFromDesc : books.nbv;
  const gainLoss = round2(saleAmount - books.nbv);
  const typeKey = normalizeDisposalType(
    (asset as any).disposalType || (asset as any).disposal_type,
    desc,
  );

  const img = resolveAssetImageSrc(
    asset.id,
    (asset as any).assetImage ?? (asset as any).asset_image,
  );

  return {
    id: asset.id,
    asset,
    assetName: `${asset.type || "Asset"} – ${formatAssetRegisterId(asset)}`,
    category: asset.category || "General",
    purchaseDate: toIsoDay(asset.purchaseDate || (asset as any).purchase_date),
    disposalDate,
    cost: books.cost,
    accDep: books.accDep,
    nbv: books.nbv,
    saleAmount,
    gainLoss,
    disposalType: disposalTypeLabel(typeKey),
    disposalTypeKey: typeKey,
    imageUrl: img || undefined,
  };
}

function shiftYearIso(iso: string, deltaYears: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${y + deltaYears}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function trendLabel(current: number, previous: number, mode: "count" | "pct"): string | null {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return mode === "count" ? `↑ ${current}` : "↑ New";
  const diff = current - previous;
  if (Math.abs(diff) < 0.005) return "→ 0%";
  if (mode === "count") {
    return diff >= 0 ? `↑ ${diff} vs last year` : `↓ ${Math.abs(diff)} vs last year`;
  }
  const pct = Math.round((diff / Math.abs(previous)) * 100);
  return pct >= 0 ? `↑ ${pct}%` : `↓ ${Math.abs(pct)}%`;
}

export default function AssetDisposalReportPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { selectedCompany, isLoading: authLoading } = useAuth();

  const [dateFrom, setDateFrom] = useState("2026-01-01");
  const [dateTo, setDateTo] = useState("2028-12-31");
  const [category, setCategory] = useState("all");
  const [disposalType, setDisposalType] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [applied, setApplied] = useState({
    dateFrom: "2026-01-01",
    dateTo: "2028-12-31",
    category: "all",
    disposalType: "all",
    statusFilter: "all",
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: assets = [], isLoading } = useQuery<Asset[]>({
    queryKey: ["/api/assets"],
    enabled: !authLoading && !!selectedCompany,
  });

  const allDisposed = useMemo(() => {
    const list = Array.isArray(assets) ? assets : [];
    return list
      .filter((a) => {
        const s = String(a.status || "").toLowerCase();
        return s === "disposed" || s === "retired";
      })
      .map(buildDisposalRowFromAsset);
  }, [assets]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const row of allDisposed) {
      if (row.category && row.category !== "—") set.add(row.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allDisposed]);

  const rows = useMemo(() => {
    return allDisposed.filter((row) => {
      if (applied.dateFrom && row.disposalDate && row.disposalDate < applied.dateFrom) return false;
      if (applied.dateTo && row.disposalDate && row.disposalDate > applied.dateTo) return false;
      if (applied.category !== "all" && row.category !== applied.category) return false;
      if (applied.disposalType !== "all" && row.disposalTypeKey !== applied.disposalType) return false;
      if (applied.statusFilter === "disposed" && row.asset) {
        const s = String(row.asset.status || "").toLowerCase();
        if (s !== "disposed") return false;
      }
      if (applied.statusFilter === "retired" && row.asset) {
        const s = String(row.asset.status || "").toLowerCase();
        if (s !== "retired") return false;
      }
      return true;
    });
  }, [allDisposed, applied]);

  const selected = useMemo(() => {
    if (selectedId != null) {
      const match = rows.find((r) => r.id === selectedId);
      if (match) return match;
    }
    return rows[0] || null;
  }, [rows, selectedId]);

  const kpis = useMemo(() => {
    const summarize = (list: DisposalRowItem[]) => {
      const totalDisposed = list.length;
      const totalSale = round2(list.reduce((s, r) => s + r.saleAmount, 0));
      const totalLoss = round2(
        list.reduce((s, r) => s + (r.gainLoss < 0 ? Math.abs(r.gainLoss) : 0), 0),
      );
      const totalProfit = round2(
        list.reduce((s, r) => s + (r.gainLoss > 0 ? r.gainLoss : 0), 0),
      );
      const scrapped = round2(
        list.filter((r) => r.disposalTypeKey === "scrap").reduce((s, r) => s + r.saleAmount, 0),
      );
      const others = round2(
        list
          .filter((r) => r.disposalTypeKey !== "scrap" && r.gainLoss === 0)
          .reduce((s, r) => s + r.saleAmount, 0),
      );
      return { totalDisposed, totalSale, totalLoss, totalProfit, scrapped, others };
    };

    const current = summarize(rows);

    const prevFrom = shiftYearIso(applied.dateFrom, -1);
    const prevTo = shiftYearIso(applied.dateTo, -1);
    const priorRows = allDisposed.filter((row) => {
      if (prevFrom && row.disposalDate && row.disposalDate < prevFrom) return false;
      if (prevTo && row.disposalDate && row.disposalDate > prevTo) return false;
      if (applied.category !== "all" && row.category !== applied.category) return false;
      if (applied.disposalType !== "all" && row.disposalTypeKey !== applied.disposalType) return false;
      if (applied.statusFilter === "disposed" && row.asset) {
        if (String(row.asset.status || "").toLowerCase() !== "disposed") return false;
      }
      if (applied.statusFilter === "retired" && row.asset) {
        if (String(row.asset.status || "").toLowerCase() !== "retired") return false;
      }
      return true;
    });
    const prior = summarize(priorRows);

    return {
      totalDisposed: current.totalDisposed,
      totalSaleFormatted: formatIntCurrency(current.totalSale),
      totalLossFormatted: formatIntCurrency(current.totalLoss),
      totalProfitFormatted: formatIntCurrency(current.totalProfit),
      disposedHint: trendLabel(current.totalDisposed, prior.totalDisposed, "count"),
      saleHint: trendLabel(current.totalSale, prior.totalSale, "pct"),
      lossHint: trendLabel(current.totalLoss, prior.totalLoss, "pct"),
      profitHint: trendLabel(current.totalProfit, prior.totalProfit, "pct"),
      saleRaw: current.totalSale,
      profitRaw: current.totalProfit,
      lossRaw: current.totalLoss,
      scrappedRaw: current.scrapped,
      othersRaw: current.others,
    };
  }, [rows, allDisposed, applied]);

  function generateReport() {
    const nextApplied = {
      dateFrom,
      dateTo,
      category,
      disposalType,
      statusFilter,
    };
    setApplied(nextApplied);
    const nextRows = allDisposed.filter((row) => {
      if (nextApplied.dateFrom && row.disposalDate && row.disposalDate < nextApplied.dateFrom) return false;
      if (nextApplied.dateTo && row.disposalDate && row.disposalDate > nextApplied.dateTo) return false;
      if (nextApplied.category !== "all" && row.category !== nextApplied.category) return false;
      if (nextApplied.disposalType !== "all" && row.disposalTypeKey !== nextApplied.disposalType) return false;
      if (nextApplied.statusFilter === "disposed" && row.asset) {
        if (String(row.asset.status || "").toLowerCase() !== "disposed") return false;
      }
      if (nextApplied.statusFilter === "retired" && row.asset) {
        if (String(row.asset.status || "").toLowerCase() !== "retired") return false;
      }
      return true;
    });
    setSelectedId(nextRows[0]?.id ?? null);
    toast({
      title: "Report generated",
      description:
        nextRows.length > 0
          ? `${nextRows.length} disposed asset${nextRows.length === 1 ? "" : "s"} matched.`
          : "No disposed assets match these filters.",
    });
  }

  function resetFilters() {
    setDateFrom("2026-01-01");
    setDateTo("2028-12-31");
    setCategory("all");
    setDisposalType("all");
    setStatusFilter("all");
    setApplied({
      dateFrom: "2026-01-01",
      dateTo: "2028-12-31",
      category: "all",
      disposalType: "all",
      statusFilter: "all",
    });
    setSelectedId(null);
  }

  function handleExportExcel() {
    if (rows.length === 0) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }
    const data = rows.map((r, idx) => ({
      "#": idx + 1,
      "Asset Name": r.assetName,
      "Asset Category": r.category,
      "Purchase Date": formatDmy(r.purchaseDate),
      "Disposal Date": formatDmy(r.disposalDate),
      "Original Cost (S$)": r.cost,
      "Accum. Depreciation (S$)": r.accDep,
      "Net Book Value (S$)": r.nbv,
      "Sale Amount (S$)": r.saleAmount,
      "Gain / Loss (S$)": r.gainLoss,
      "Disposal Type": r.disposalType,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Disposal Report");
    XLSX.writeFile(wb, `asset-disposal-report-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    toast({ title: "Export successful", description: "Excel file downloaded." });
  }

  function handleExportPdf() {
    if (rows.length === 0) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFontSize(16);
    doc.setTextColor(37, 99, 235);
    doc.text("Fixed Asset Disposal Report", 14, 15);
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(
      `Generated: ${format(new Date(), "dd/MM/yyyy")}  |  Records: ${rows.length}`,
      14,
      21,
    );
    (doc as any).autoTable({
      startY: 25,
      head: [[
        "#", "Asset Name", "Category", "Purchase Date", "Disposal Date",
        "Cost", "Acc. Dep", "NBV", "Sale", "Gain/Loss", "Type",
      ]],
      body: rows.map((r, idx) => [
        idx + 1,
        r.assetName,
        r.category,
        formatDmy(r.purchaseDate),
        formatDmy(r.disposalDate),
        format2Dec(r.cost),
        format2Dec(r.accDep),
        format2Dec(r.nbv),
        format2Dec(r.saleAmount),
        r.gainLoss > 0 ? format2Dec(r.gainLoss) : format2Dec(r.gainLoss),
        r.disposalType,
      ]),
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 7, cellPadding: 1.5 },
    });
    doc.save(`asset-disposal-report-${format(new Date(), "yyyy-MM-dd")}.pdf`);
    toast({ title: "Export successful", description: "PDF file downloaded." });
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300 pb-12">
      {/* 1. TOP FILTER BAR (White card, clean inputs) */}
      <div className="rounded-xl border border-[#DBEAFE] bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-[1.5fr_1.1fr_1.1fr_1fr_auto_auto] items-end">
          {/* Date Range */}
          <div className="space-y-1 sm:col-span-2 md:col-span-2 lg:col-span-1">
            <Label className="text-xs font-semibold text-[#334155]">Date Range</Label>
            <div className="grid grid-cols-2 gap-2">
              <SyncBridgeDatePicker
                value={dateFrom}
                onChange={(v) => setDateFrom(v || dateFrom)}
                mode="date"
                placeholder="From date"
                className="h-9 border-[#CBD5E1] bg-white text-xs"
              />
              <SyncBridgeDatePicker
                value={dateTo}
                onChange={(v) => setDateTo(v || dateTo)}
                mode="date"
                placeholder="To date"
                className="h-9 border-[#CBD5E1] bg-white text-xs"
              />
            </div>
          </div>

          {/* Asset Category */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-[#334155]">Asset Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9 bg-white border-[#CBD5E1] text-xs text-[#0F172A]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Disposal Type */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-[#334155]">Disposal Type</Label>
            <Select value={disposalType} onValueChange={setDisposalType}>
              <SelectTrigger className="h-9 bg-white border-[#CBD5E1] text-xs text-[#0F172A]">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                {DISPOSAL_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-[#334155]">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 bg-white border-[#CBD5E1] text-xs text-[#0F172A]">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All</SelectItem>
                <SelectItem value="disposed" className="text-xs">Disposed</SelectItem>
                <SelectItem value="retired" className="text-xs">Retired</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Generate Report Button */}
          <Button
            type="button"
            className="h-9 gap-1.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-medium px-4 rounded-md shadow-none"
            onClick={generateReport}
          >
            <Search className="h-3.5 w-3.5" />
            Generate Report
          </Button>

          {/* Reset Button */}
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-1.5 border-[#CBD5E1] bg-white hover:bg-slate-50 text-[#334155] text-xs font-medium px-3 rounded-md shadow-none"
            onClick={resetFilters}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
      </div>

      {/* 2. 4 KPI CARDS (Left solid icon badge, exact background & text styling) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Disposed Assets */}
        <div className="rounded-xl border border-[#DBEAFE] bg-[#F0F7FF] p-4 flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#2563EB] text-white shrink-0 shadow-sm">
            <Trash2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#475569]">Total Disposed Assets</p>
            <p className="text-[24px] font-bold text-[#0F172A] leading-tight mt-0.5 tabular-nums">
              {kpis.totalDisposed}
            </p>
            {kpis.disposedHint ? (
              <p className={cn(
                "text-xs font-medium mt-1",
                kpis.disposedHint.startsWith("↓") ? "text-[#DC2626]" : "text-[#16A34A]",
              )}>
                {kpis.disposedHint}
              </p>
            ) : null}
          </div>
        </div>

        {/* Card 2: Total Sale Value */}
        <div className="rounded-xl border border-[#DCFCE7] bg-[#F0FDF4] p-4 flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#16A34A] text-white shrink-0 shadow-sm">
            <Coins className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#475569]">Total Sale Value</p>
            <p className="text-[24px] font-bold text-[#0F172A] leading-tight mt-0.5 tabular-nums">
              {kpis.totalSaleFormatted}
            </p>
            {kpis.saleHint ? (
              <p className={cn(
                "text-xs font-medium mt-1",
                kpis.saleHint.startsWith("↓") ? "text-[#DC2626]" : "text-[#16A34A]",
              )}>
                {kpis.saleHint}
              </p>
            ) : null}
          </div>
        </div>

        {/* Card 3: Total Loss */}
        <div className="rounded-xl border border-[#FFEDD5] bg-[#FFF7ED] p-4 flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EA580C] text-white shrink-0 shadow-sm">
            <TrendingDown className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#475569]">Total Loss</p>
            <p className="text-[24px] font-bold text-[#0F172A] leading-tight mt-0.5 tabular-nums">
              {kpis.totalLossFormatted}
            </p>
            {kpis.lossHint ? (
              <p className={cn(
                "text-xs font-medium mt-1",
                kpis.lossHint.startsWith("↓") ? "text-[#DC2626]" : "text-[#16A34A]",
              )}>
                {kpis.lossHint}
              </p>
            ) : null}
          </div>
        </div>

        {/* Card 4: Total Profit */}
        <div className="rounded-xl border border-[#F3E8FF] bg-[#FAF5FF] p-4 flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#7C3AED] text-white shrink-0 shadow-sm">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#475569]">Total Profit</p>
            <p className="text-[24px] font-bold text-[#0F172A] leading-tight mt-0.5 tabular-nums">
              {kpis.totalProfitFormatted}
            </p>
            {kpis.profitHint ? (
              <p className={cn(
                "text-xs font-medium mt-1",
                kpis.profitHint.startsWith("↓") ? "text-[#DC2626]" : "text-[#16A34A]",
              )}>
                {kpis.profitHint}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* 3. DISPOSED ASSETS DETAILS TABLE */}
      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm">
        {/* Table Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#2563EB]" />
            <h2 className="text-[15px] font-bold text-[#0F172A]">Disposed Assets Details</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-[#CBD5E1] bg-white hover:bg-slate-50 text-xs font-medium text-[#334155] shadow-none"
              onClick={handleExportExcel}
            >
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-[#16A34A] text-white text-[9px] font-bold">
                X
              </span>
              Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-[#CBD5E1] bg-white hover:bg-slate-50 text-xs font-medium text-[#334155] shadow-none"
              onClick={handlePrint}
            >
              <Printer className="h-3.5 w-3.5 text-[#2563EB]" />
              Print
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-[#CBD5E1] bg-white hover:bg-slate-50 text-xs font-medium text-[#334155] shadow-none"
              onClick={handleExportPdf}
            >
              <FileText className="h-3.5 w-3.5 text-[#64748B]" />
              PDF
            </Button>
          </div>
        </div>

        {/* Table Data */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                <TableHead className="w-10 text-xs font-semibold text-[#334155]">#</TableHead>
                <TableHead className="text-xs font-semibold text-[#334155]">Asset Name</TableHead>
                <TableHead className="text-xs font-semibold text-[#334155]">Asset Category</TableHead>
                <TableHead className="text-xs font-semibold text-[#334155]">Purchase Date</TableHead>
                <TableHead className="text-xs font-semibold text-[#334155]">Disposal Date</TableHead>
                <TableHead className="text-right text-xs font-semibold text-[#334155]">Original Cost (S$)</TableHead>
                <TableHead className="text-right text-xs font-semibold text-[#334155]">Accum. Depreciation (S$)</TableHead>
                <TableHead className="text-right text-xs font-semibold text-[#334155]">Net Book Value (S$)</TableHead>
                <TableHead className="text-right text-xs font-semibold text-[#334155]">Sale Amount (S$)</TableHead>
                <TableHead className="text-right text-xs font-semibold text-[#334155]">Gain / Loss (S$)</TableHead>
                <TableHead className="text-xs font-semibold text-[#334155]">Disposal Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-xs text-[#94A3B8]">
                    Loading assets...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-xs text-[#94A3B8]">
                    No disposed assets found for the selected filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, idx) => {
                  const isSelected = selected?.id === row.id;
                  return (
                    <TableRow
                      key={row.id}
                      className={cn(
                        "cursor-pointer transition-colors border-b border-[#F1F5F9] hover:bg-[#F8FAFC]",
                        isSelected && "bg-[#F0F7FF]",
                      )}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <TableCell className="text-xs text-[#475569]">{idx + 1}</TableCell>
                      <TableCell className="text-xs font-medium text-[#0F172A] whitespace-nowrap">
                        {row.assetName}
                      </TableCell>
                      <TableCell className="text-xs text-[#334155] whitespace-nowrap">{row.category}</TableCell>
                      <TableCell className="text-xs text-[#334155] whitespace-nowrap">{formatDmy(row.purchaseDate)}</TableCell>
                      <TableCell className="text-xs text-[#334155] whitespace-nowrap">{formatDmy(row.disposalDate)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-[#0F172A]">{format2Dec(row.cost)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-[#0F172A]">{format2Dec(row.accDep)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-[#0F172A]">{format2Dec(row.nbv)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-[#0F172A]">{format2Dec(row.saleAmount)}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right text-xs tabular-nums font-bold",
                          row.gainLoss < 0 ? "text-[#DC2626]" : "text-[#16A34A]",
                        )}
                      >
                        {format2Dec(row.gainLoss)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex rounded-full px-3 py-0.5 text-xs font-medium",
                            disposalTypeBadgeClass(row.disposalTypeKey),
                          )}
                        >
                          {row.disposalType}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* 4. BOTTOM SECTION: DISPOSAL SUMMARY CHART + ASSET DISPOSAL DETAILS */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[38%_1fr]">
        {/* Left Card: Disposal Summary Chart (compact width) */}
        <section className="overflow-hidden rounded-xl border border-[#DBEAFE] bg-white shadow-sm flex flex-col">
          <div className="flex items-center gap-2 bg-[#EEF4FF] px-4 py-2.5 border-b border-[#DBEAFE]">
            <Clock className="h-4 w-4 text-[#2563EB]" />
            <h3 className="text-sm font-bold text-[#1E3A8A]">Disposal Summary Chart</h3>
          </div>
          <div className="p-5 flex-1 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 min-h-[220px]">
            {(() => {
              const chartParts = [
                { key: "profit", label: "Profit", color: "#2563EB", value: kpis.profitRaw },
                { key: "loss", label: "Loss", color: "#DC2626", value: kpis.lossRaw },
                { key: "scrapped", label: "Scrapped", color: "#EA580C", value: kpis.scrappedRaw },
                { key: "others", label: "Others", color: "#7C3AED", value: kpis.othersRaw },
              ];
              const chartTotal = chartParts.reduce((s, p) => s + Math.max(0, p.value), 0);
              const circumference = 2 * Math.PI * 54;
              let offset = 0;
              const arcs = chartParts.map((part) => {
                const share = chartTotal > 0 ? Math.max(0, part.value) / chartTotal : 0;
                const length = share * circumference;
                const dasharray = `${length} ${Math.max(0, circumference - length)}`;
                const dashoffset = -offset;
                offset += length;
                return { ...part, share, dasharray, dashoffset, pct: Math.round(share * 100) };
              });

              return (
                <>
                  <div className="relative h-[150px] w-[150px] shrink-0">
                    <svg viewBox="0 0 160 160" className="h-full w-full">
                      {chartTotal <= 0 ? (
                        <circle
                          cx="80"
                          cy="80"
                          r="54"
                          fill="none"
                          stroke="#E2E8F0"
                          strokeWidth="20"
                        />
                      ) : (
                        arcs.map((arc) => (
                          <circle
                            key={arc.key}
                            cx="80"
                            cy="80"
                            r="54"
                            fill="none"
                            stroke={arc.color}
                            strokeWidth="20"
                            strokeDasharray={arc.dasharray}
                            strokeDashoffset={arc.dashoffset}
                            transform="rotate(-90 80 80)"
                          />
                        ))
                      )}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                      <span className="text-[16px] font-bold text-[#0F172A] leading-tight">
                        {kpis.totalSaleFormatted}
                      </span>
                      <span className="text-[11px] text-[#64748B] mt-0.5">Total Sale</span>
                    </div>
                  </div>

                  <div className="space-y-2.5 min-w-[170px] shrink-0">
                    {arcs.map((arc) => (
                      <div key={arc.key} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: arc.color }}
                          />
                          <span className="text-[#334155] font-medium">{arc.label}</span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="font-semibold text-[#0F172A] tabular-nums">
                            {formatIntCurrency(arc.value)}
                          </span>
                          <span className="text-[#64748B] text-right w-9">({arc.pct}%)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </section>

        {/* Right Card: Asset Disposal Details (wider width) */}
        <section className="overflow-hidden rounded-xl border border-[#DBEAFE] bg-white shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between bg-[#EEF4FF] px-4 py-2 border-b border-[#DBEAFE]">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-[#2563EB]" />
              <h3 className="text-sm font-bold text-[#1E3A8A]">Asset Disposal Details</h3>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 border-[#BFDBFE] bg-white hover:bg-blue-50 text-[11px] font-medium text-[#2563EB] px-2.5 shadow-none"
              onClick={() => {
                if (selected?.asset?.id) {
                  setLocation(`/assets/${selected.asset.id}/edit`);
                } else {
                  setLocation("/assets/disposal");
                }
              }}
            >
              <Eye className="h-3 w-3" />
              View Details
            </Button>
          </div>

          {selected ? (
            <div className="p-4 sm:p-5 flex-1 flex flex-col justify-center">
              <div className="grid grid-cols-1 md:grid-cols-[130px_1fr_auto_1.15fr] gap-4 sm:gap-5 items-stretch">
                {/* Left Column: Asset Thumbnail */}
                <div className="flex items-center justify-center">
                  {selected.imageUrl ? (
                    <img
                      src={selected.imageUrl}
                      alt={selected.assetName}
                      className="max-h-24 max-w-full w-auto object-contain rounded-md"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-md border border-dashed border-[#CBD5E1] bg-[#F8FAFC] text-[11px] text-[#94A3B8]">
                      No image
                    </div>
                  )}
                </div>

                {/* Middle Column: Metadata */}
                <div className="space-y-2 text-xs flex flex-col justify-center">
                  <div className="flex items-center">
                    <span className="w-24 text-[#475569]">Asset Name</span>
                    <span className="mr-2 text-[#475569]">:</span>
                    <span className="font-semibold text-[#0F172A] truncate">{selected.assetName}</span>
                  </div>
                  <div className="flex items-center">
                    <span className="w-24 text-[#475569]">Purchase Date</span>
                    <span className="mr-2 text-[#475569]">:</span>
                    <span className="font-semibold text-[#0F172A]">{formatDmy(selected.purchaseDate)}</span>
                  </div>
                  <div className="flex items-center">
                    <span className="w-24 text-[#475569]">Disposal Date</span>
                    <span className="mr-2 text-[#475569]">:</span>
                    <span className="font-semibold text-[#0F172A]">{formatDmy(selected.disposalDate)}</span>
                  </div>
                  <div className="flex items-center">
                    <span className="w-24 text-[#475569]">Disposal Type</span>
                    <span className="mr-2 text-[#475569]">:</span>
                    <span className="font-semibold text-[#0F172A]">{selected.disposalType}</span>
                  </div>
                </div>

                {/* Middle Vertical Divider Line */}
                <div className="hidden md:block w-[1px] bg-[#E2E8F0] self-stretch my-0.5" />

                {/* Right Column: Financials + Banner directly below */}
                <div className="flex flex-col justify-between">
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center">
                      <span className="w-28 text-[#475569]">Original Cost</span>
                      <span className="mr-2 text-[#475569]">:</span>
                      <span className="font-semibold text-[#0F172A] tabular-nums">
                        S$ {format2Dec(selected.cost)}
                      </span>
                    </div>
                    <div className="flex items-center">
                      <span className="w-28 text-[#475569]">Accumulated Dep.</span>
                      <span className="mr-2 text-[#475569]">:</span>
                      <span className="font-semibold text-[#0F172A] tabular-nums">
                        S$ {format2Dec(selected.accDep)}
                      </span>
                    </div>
                    <div className="flex items-center">
                      <span className="w-28 text-[#475569]">Net Book Value</span>
                      <span className="mr-2 text-[#475569]">:</span>
                      <span className="font-semibold text-[#0F172A] tabular-nums">
                        S$ {format2Dec(selected.nbv)}
                      </span>
                    </div>
                    <div className="flex items-center">
                      <span className="w-28 text-[#475569]">Sale Amount</span>
                      <span className="mr-2 text-[#475569]">:</span>
                      <span className="font-semibold text-[#0F172A] tabular-nums">
                        S$ {format2Dec(selected.saleAmount)}
                      </span>
                    </div>
                  </div>

                  {/* Banner under financials — matches mock: "Loss on Disposal : S$ 200.00" */}
                  <div
                    className={cn(
                      "mt-2.5 rounded-md px-3.5 py-2 text-xs font-bold tabular-nums",
                      selected.gainLoss > 0
                        ? "bg-[#DCFCE7] text-[#16A34A]"
                        : "bg-[#FEE2E2] text-[#DC2626]",
                    )}
                  >
                    {selected.gainLoss > 0
                      ? `Gain on Disposal : S$ ${format2Dec(selected.gainLoss)}`
                      : `Loss on Disposal : S$ ${format2Dec(Math.abs(selected.gainLoss))}`}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
