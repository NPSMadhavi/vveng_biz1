import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { useFollowWorkingYear } from "@/components/financial-year-controls";
import { useToast } from "@/hooks/use-toast";
import { Check, Download, Loader2, BookOpen, Pencil, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateGeneralLedger_PDF } from "@/lib/pdf";

interface GLAccount { id: number; code: string; name: string; type: string }
interface GLTransaction {
  journalEntryId: number;
  date: string;
  reference: string | null;
  voucherType?: string;
  description: string | null;
  debit: number;
  credit: number;
  balance: number;
  sourcePath?: string;
}

function initialLedgerFilters() {
  const params = new URLSearchParams(window.location.search);
  const today = new Date().toISOString().split("T")[0];
  const accountRaw = Number(params.get("accountId"));
  return {
    accountId: Number.isFinite(accountRaw) && accountRaw > 0 ? accountRaw : null,
    from: params.get("from") || today.slice(0, 7) + "-01",
    to: params.get("to") || today,
  };
}

function ledgerReturnPath(accountId: number | null, from: string, to: string) {
  const params = new URLSearchParams();
  if (accountId) params.set("accountId", String(accountId));
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return query ? `/accounting/general-ledger?${query}` : "/accounting/general-ledger";
}
interface GLData {
  account: { id: number; code: string; name: string; type: string; subType: string | null } | null;
  accounts: GLAccount[];
  openingBalance: number;
  closingBalance: number;
  transactions: GLTransaction[];
}

const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];
const TYPE_LABEL: Record<string, string> = {
  asset: "Assets", liability: "Liabilities", equity: "Equity",
  revenue: "Revenue", expense: "Expenses",
};

function fmtAmt(n: number) {
  if (Math.abs(n) < 0.005) return null;
  return new Intl.NumberFormat("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
}
function fmtBal(n: number) {
  const s = new Intl.NumberFormat("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  return n < 0 ? `(${s})` : s;
}
function fmtBalDrCr(n: number) {
  const s = new Intl.NumberFormat("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  if (Math.abs(n) < 0.005) return "0.00";
  return n > 0 ? `${s} Dr` : `${s} Cr`;
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
}

/** Lower score = better match (exact code → name starts with → name includes → code). */
function matchRank(account: GLAccount, q: string): number {
  const code = account.code.toLowerCase();
  const name = account.name.toLowerCase();
  if (code === q) return 0;
  if (name === q) return 1;
  if (code.startsWith(q)) return 2;
  if (name.startsWith(q)) return 3;
  if (name.includes(q)) return 4;
  if (code.includes(q)) return 5;
  return 90;
}

export default function GeneralLedgerPage() {
  const { selectedCompany } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const today = new Date().toISOString().split("T")[0];
  const boot = useState(initialLedgerFilters)[0];
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(boot.accountId);
  const [from, setFrom] = useState(boot.from);
  const [to, setTo] = useState(boot.to);
  const urlLocked = useRef(new URLSearchParams(window.location.search).has("from") || new URLSearchParams(window.location.search).has("to"));
  useFollowWorkingYear(urlLocked.current, (nextFrom, nextTo) => {
    setFrom(nextFrom);
    setTo(nextTo);
  });
  const [search, setSearch] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [cachedAccounts, setCachedAccounts] = useState<GLAccount[]>([]);
  const [editingOpening, setEditingOpening] = useState(false);
  const [openingDraft, setOpeningDraft] = useState("");
  const [openingSide, setOpeningSide] = useState<"Dr" | "Cr">("Dr");
  const [savingOpening, setSavingOpening] = useState(false);

  const { data, isLoading, isError, error } = useQuery<GLData>({
    queryKey: ["general-ledger", selectedAccountId, from, to],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (selectedAccountId) p.set("accountId", String(selectedAccountId));
      if (from) p.set("from", from);
      if (to)   p.set("to", to);
      const r = await fetch(`/api/general-ledger?${p}`, { credentials: "include" });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Failed to load"); }
      return r.json();
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    setEditingOpening(false);
    setOpeningDraft("");
  }, [selectedAccountId, from, to]);

  const displayOpening = data?.openingBalance ?? 0;
  const adjustedTransactions = useMemo(() => {
    if (!data?.transactions) return [] as GLTransaction[];
    let running = displayOpening;
    return data.transactions.map((tx) => {
      running += tx.debit - tx.credit;
      return { ...tx, balance: Math.round(running * 100) / 100 };
    });
  }, [data?.transactions, displayOpening]);
  const displayClosing = adjustedTransactions.length
    ? adjustedTransactions[adjustedTransactions.length - 1].balance
    : displayOpening;

  function startEditOpening() {
    if (!data) return;
    const bal = data.openingBalance;
    const defaultSide: "Dr" | "Cr" =
      bal > 0.005 ? "Dr"
      : bal < -0.005 ? "Cr"
      : ["liability", "equity", "revenue"].includes(data.account?.type || "") ? "Cr" : "Dr";
    setOpeningSide(defaultSide);
    setOpeningDraft(Math.abs(bal).toFixed(2));
    setEditingOpening(true);
  }

  async function saveOpeningBalance() {
    if (!selectedAccountId || !from) {
      toast({ title: "Select account and From date first", variant: "destructive" });
      return;
    }
    const parsed = Number(String(openingDraft).replace(/,/g, "").trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast({ title: "Enter a valid non-negative opening balance", variant: "destructive" });
      return;
    }
    const signedAmount = openingSide === "Cr" ? -Math.abs(parsed) : Math.abs(parsed);
    setSavingOpening(true);
    try {
      const r = await fetch("/api/general-ledger/opening-balance", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: selectedAccountId, from, amount: signedAmount }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "Failed to save opening balance");
      setEditingOpening(false);
      await queryClient.invalidateQueries({ queryKey: ["general-ledger", selectedAccountId, from, to] });
      await queryClient.invalidateQueries({ queryKey: ["balance-sheet"] });
      await queryClient.invalidateQueries({ queryKey: ["trial-balance"] });
      toast({ title: "Opening balance updated" });
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingOpening(false);
    }
  }

  // Keep the full Chart of Accounts available for search even when query key changes
  useEffect(() => {
    if (data?.accounts?.length) setCachedAccounts(data.accounts);
  }, [data?.accounts]);

  const accounts = cachedAccounts.length > 0 ? cachedAccounts : (data?.accounts ?? []);
  const searchQuery = search.trim().toLowerCase();
  const isSearching = searchQuery.length > 0;

  const filteredAccounts = useMemo(() => {
    if (!isSearching) return [] as GLAccount[];
    return accounts
      .filter(a =>
        a.code.toLowerCase().includes(searchQuery) ||
        a.name.toLowerCase().includes(searchQuery) ||
        (TYPE_LABEL[a.type] || a.type).toLowerCase().includes(searchQuery)
      )
      .slice()
      .sort((a, b) => {
        const ra = matchRank(a, searchQuery);
        const rb = matchRank(b, searchQuery);
        if (ra !== rb) return ra - rb;
        return a.code.localeCompare(b.code, undefined, { numeric: true });
      });
  }, [accounts, isSearching, searchQuery]);

  const bestMatchId = filteredAccounts[0]?.id ?? null;

  // Any search hit → open best-match ledger immediately (e.g. "cash at bank" → 1010)
  useEffect(() => {
    if (!isSearching) return;
    setSelectedAccountId(bestMatchId);
  }, [isSearching, searchQuery, bestMatchId]);

  const dropdownAccounts = accounts;
  const dropdownGrouped = useMemo(() =>
    TYPE_ORDER.reduce<Record<string, GLAccount[]>>((acc, t) => {
      acc[t] = dropdownAccounts.filter(a => a.type === t);
      return acc;
    }, {}),
  [dropdownAccounts]);

  function selectAccount(id: number) {
    setSelectedAccountId(id);
    setSearch("");
  }

  function openTransaction(tx: GLTransaction) {
    const path = tx.sourcePath || `/accounting/journal-entries/${tx.journalEntryId}`;
    const returnTo = encodeURIComponent(ledgerReturnPath(selectedAccountId, from, to));
    const join = path.includes("?") ? "&" : "?";
    setLocation(`${path}${join}returnTo=${returnTo}`);
  }

  async function handleDownloadPDF() {
    if (!data || !data.account) return;
    setPdfLoading(true);
    try {
      await generateGeneralLedger_PDF(
        selectedCompany as any, data.account, from || null, to || null,
        displayOpening, displayClosing, adjustedTransactions
      );
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div className="space-y-6 pb-12">

      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold text-[#2563EB]">Account Ledger</h1>
        </div>
        {data?.account && (adjustedTransactions.length > 0 || Math.abs(displayOpening) > 0.005) && (
          <Button variant="outline" size="sm" onClick={handleDownloadPDF} disabled={pdfLoading}>
            {pdfLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Download PDF
          </Button>
        )}
      </div>

      {/* Top filters: search + chart of accounts + date range */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by code or name…"
                  className="pl-9 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5 md:col-span-1 xl:col-span-1">
              <Label className="text-xs text-muted-foreground">Chart of Accounts</Label>
              <Select
                value={selectedAccountId != null ? String(selectedAccountId) : undefined}
                onValueChange={(v) => {
                  if (v) selectAccount(Number(v));
                  else setSelectedAccountId(null);
                }}
                disabled={isLoading && !data}
              >
                <SelectTrigger className="w-full text-sm">
                  <SelectValue placeholder={isLoading && !data ? "Loading accounts…" : "Select an account"} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {dropdownAccounts.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No accounts found
                    </div>
                  ) : (
                    TYPE_ORDER.map(type =>
                      dropdownGrouped[type]?.length > 0 ? (
                        <SelectGroup key={type}>
                          <SelectLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {TYPE_LABEL[type]}
                          </SelectLabel>
                          {dropdownGrouped[type].map(acct => (
                            <SelectItem key={acct.id} value={String(acct.id)}>
                              <span className="font-mono text-xs text-muted-foreground mr-2">{acct.code}</span>
                              {acct.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null
                    )
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} className="text-sm" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)} className="text-sm" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ledger / empty / no-match */}
      <div className="space-y-4">
        {isSearching && filteredAccounts.length === 0 && (
          <div className="text-center py-16 text-sm text-muted-foreground border rounded-lg bg-muted/10">
            No accounts match “{search.trim()}”
          </div>
        )}

        {!selectedAccountId && !isSearching && (
          <div className="flex flex-col items-center justify-center py-24 text-center border rounded-lg bg-muted/10">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <BookOpen className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">Select an account</p>
            <p className="text-xs text-muted-foreground">Search by code/name above, or pick from Chart of Accounts</p>
          </div>
        )}

        {isError && <div className="text-center py-12 text-red-600 text-sm">{(error as Error).message}</div>}
        {isLoading && selectedAccountId && <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>}

        {data?.account && selectedAccountId && (
          <div className="space-y-4">
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-[#1a365d] text-white px-5 py-3">
                <p className="text-[10px] tracking-widest uppercase opacity-70 mb-0.5">{data.account.code} · {data.account.type}</p>
                <p className="text-base font-bold">{data.account.name}</p>
              </div>
              <div className="grid grid-cols-2 divide-x divide-border bg-muted/30">
                <div className="px-5 py-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Opening Balance</p>
                  {editingOpening ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={openingDraft}
                        onChange={(e) => setOpeningDraft(e.target.value)}
                        className="h-8 max-w-[140px] font-mono text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveOpeningBalance();
                          if (e.key === "Escape") setEditingOpening(false);
                        }}
                      />
                      <div className="inline-flex rounded-md border border-input overflow-hidden h-8">
                        <button
                          type="button"
                          onClick={() => setOpeningSide("Dr")}
                          className={cn("px-2.5 text-xs font-semibold transition-colors", openingSide === "Dr" ? "bg-[#1a365d] text-white" : "bg-background text-muted-foreground hover:bg-muted")}
                        >
                          Dr
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpeningSide("Cr")}
                          className={cn("px-2.5 text-xs font-semibold transition-colors border-l border-input", openingSide === "Cr" ? "bg-[#1a365d] text-white" : "bg-background text-muted-foreground hover:bg-muted")}
                        >
                          Cr
                        </button>
                      </div>
                      <Button type="button" size="icon" className="h-8 w-8 shrink-0" onClick={() => void saveOpeningBalance()} disabled={savingOpening}>
                        {savingOpening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setEditingOpening(false)} disabled={savingOpening}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className={cn("text-sm font-semibold font-mono tabular-nums", displayOpening < 0 ? "text-red-600" : "text-foreground")}>
                        {fmtBalDrCr(displayOpening)}
                      </p>
                      <button
                        type="button"
                        onClick={startEditOpening}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#2B7BE8] hover:bg-[#E8F1FC]"
                        title="Edit opening balance"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Dr = Debit (Assets/Expenses) · Cr = Credit (Liabilities/Equity/Income)
                  </p>
                </div>
                <div className="px-5 py-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Closing Balance</p>
                  <p className={cn("text-sm font-bold font-mono tabular-nums", displayClosing < 0 ? "text-red-600" : "text-foreground")}>
                    {fmtBalDrCr(displayClosing)}
                  </p>
                </div>
              </div>
            </div>

            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-border bg-muted/40">
                      <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider w-28">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Particulars</th>
                      <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider w-28">Voucher Type</th>
                      <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider w-28">Voucher No.</th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider w-32">Debit</th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider w-32">Credit</th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider w-40">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border bg-muted/20">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground italic">{fmtDate(from)}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground italic">Opening Balance</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground italic">Opening</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground italic">OB-001</td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono tabular-nums text-foreground">
                        {displayOpening > 0.005 ? fmtAmt(displayOpening) : "0.00"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono tabular-nums text-foreground">
                        {displayOpening < -0.005 ? fmtAmt(Math.abs(displayOpening)) : "0.00"}
                      </td>
                      <td className={cn("px-4 py-2.5 text-right text-xs font-mono tabular-nums font-semibold", displayOpening < 0 ? "text-red-600" : "text-foreground")}>
                        {fmtBalDrCr(displayOpening)}
                      </td>
                    </tr>

                    {adjustedTransactions.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-sm text-muted-foreground">
                          No transactions for this account in this period.
                        </td>
                      </tr>
                    )}

                    {adjustedTransactions.map((tx, i) => (
                      <tr
                        key={`${tx.journalEntryId}-${i}`}
                        className="border-b border-border hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => openTransaction(tx)}
                      >
                        <td className="px-4 py-2.5 text-sm text-muted-foreground">{fmtDate(tx.date)}</td>
                        <td className="px-4 py-2.5 text-sm text-foreground max-w-xs truncate">{tx.description || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">{tx.voucherType || "Journal"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{tx.reference || "—"}</td>
                        <td className="text-right px-4 py-2.5 font-mono text-sm tabular-nums text-foreground">
                          {fmtAmt(tx.debit) ?? <span className="text-muted-foreground/40">0.00</span>}
                        </td>
                        <td className="text-right px-4 py-2.5 font-mono text-sm tabular-nums text-foreground">
                          {fmtAmt(tx.credit) ?? <span className="text-muted-foreground/40">0.00</span>}
                        </td>
                        <td className={cn("text-right px-4 py-2.5 font-mono text-sm tabular-nums font-semibold", tx.balance < 0 ? "text-red-600" : "text-foreground")}>
                          {fmtBalDrCr(tx.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[#1a365d] text-white">
                      <td colSpan={4} className="px-4 py-3 text-xs font-bold uppercase tracking-wider opacity-80">Totals &amp; Closing Balance</td>
                      <td className="text-right px-4 py-3 font-mono text-sm font-bold tabular-nums text-white">
                        {fmtBal(adjustedTransactions.reduce((s, t) => s + t.debit, 0))}
                      </td>
                      <td className="text-right px-4 py-3 font-mono text-sm font-bold tabular-nums text-white">
                        {fmtBal(adjustedTransactions.reduce((s, t) => s + t.credit, 0))}
                      </td>
                      <td className={cn("text-right px-4 py-3 font-mono text-base font-bold tabular-nums", displayClosing < 0 ? "text-red-300" : "text-white")}>
                        {fmtBalDrCr(displayClosing)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
