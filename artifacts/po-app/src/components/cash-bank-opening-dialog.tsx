import { Fragment, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, Landmark, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface OpeningAccountRow {
  id: number;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity";
  subType: string | null;
  openingBalance: number;
  openingDebit: number;
  openingCredit: number;
}

interface CashBankOpeningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFromDate?: string;
}

const TYPE_GROUPS: Array<{ key: "asset" | "liability" | "equity"; label: string }> = [
  { key: "asset", label: "Assets (Cash, Bank, Receivables, Fixed Assets)" },
  { key: "liability", label: "Liabilities (Payables, GST, Loans)" },
  { key: "equity", label: "Equity (Share Capital, Retained Earnings, Reserves)" },
];

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function CashBankOpeningDialog({
  open,
  onOpenChange,
  defaultFromDate,
}: CashBankOpeningDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [fromDate, setFromDate] = useState(defaultFromDate || "");
  const [accounts, setAccounts] = useState<OpeningAccountRow[]>([]);
  const [debitDrafts, setDebitDrafts] = useState<Record<number, string>>({});
  const [creditDrafts, setCreditDrafts] = useState<Record<number, string>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadAccounts(targetFrom?: string) {
    setLoading(true);
    try {
      const q = targetFrom ? `?from=${encodeURIComponent(targetFrom)}` : "";
      const res = await fetch(`/api/accounting/opening-balances${q}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load opening balances");
      }
      const data = await res.json();
      setFromDate(data.fromDate || targetFrom || "");
      const list: OpeningAccountRow[] = data.accounts || [];
      setAccounts(list);
      const nextDr: Record<number, string> = {};
      const nextCr: Record<number, string> = {};
      for (const a of list) {
        nextDr[a.id] = a.openingDebit > 0.005 ? a.openingDebit.toFixed(2) : "";
        nextCr[a.id] = a.openingCredit > 0.005 ? a.openingCredit.toFixed(2) : "";
      }
      setDebitDrafts(nextDr);
      setCreditDrafts(nextCr);
    } catch (err: any) {
      toast({
        title: err?.message || "Failed to load opening balances",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      setSearch("");
      void loadAccounts(defaultFromDate || undefined);
    }
  }, [open, defaultFromDate]);

  const { totalDebit, totalCredit, difference, balanced } = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const a of accounts) {
      const d = Number(String(debitDrafts[a.id] ?? "").replace(/,/g, "").trim()) || 0;
      const c = Number(String(creditDrafts[a.id] ?? "").replace(/,/g, "").trim()) || 0;
      if (Number.isFinite(d) && d > 0) dr += d;
      if (Number.isFinite(c) && c > 0) cr += c;
    }
    const diff = +(dr - cr).toFixed(2);
    return {
      totalDebit: +dr.toFixed(2),
      totalCredit: +cr.toFixed(2),
      difference: diff,
      balanced: Math.abs(diff) < 0.01,
    };
  }, [accounts, debitDrafts, creditDrafts]);

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    );
  }, [accounts, search]);

  async function handleSave() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      toast({ title: "Enter a valid opening date", variant: "destructive" });
      return;
    }

    const entries: Array<{ accountId: number; amount: number }> = [];
    for (const a of accounts) {
      const rawDr = String(debitDrafts[a.id] ?? "").replace(/,/g, "").trim();
      const rawCr = String(creditDrafts[a.id] ?? "").replace(/,/g, "").trim();
      const dr = rawDr === "" ? 0 : Number(rawDr);
      const cr = rawCr === "" ? 0 : Number(rawCr);
      if (!Number.isFinite(dr) || dr < 0 || !Number.isFinite(cr) || cr < 0) {
        toast({
          title: `Enter valid non-negative amounts for ${a.code} ${a.name}`,
          variant: "destructive",
        });
        return;
      }
      const net = +(dr - cr).toFixed(2);
      // Only send accounts that have a value or had an existing opening balance to update/clear
      if (Math.abs(net) >= 0.005 || Math.abs(a.openingBalance) >= 0.005) {
        entries.push({ accountId: a.id, amount: net });
      }
    }

    if (entries.length === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/accounting/opening-balances", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ from: fromDate, entries }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save opening balances");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["trial-balance"] }),
        queryClient.invalidateQueries({ queryKey: ["balance-sheet"] }),
        queryClient.invalidateQueries({ queryKey: ["general-ledger"] }),
        queryClient.invalidateQueries({ queryKey: ["cash-flow"] }),
        queryClient.invalidateQueries({ queryKey: ["profit-loss"] }),
        queryClient.invalidateQueries({ queryKey: ["account-activity"] }),
      ]);
      toast({
        title: balanced
          ? "Opening balances saved and reconciled"
          : "Opening balances saved (unreconciled difference remains)",
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: err?.message || "Failed to save opening balances",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1E3A5F]">
            <Landmark className="h-5 w-5 text-blue-600" />
            Opening Balances &amp; Reconciliation
          </DialogTitle>
          <DialogDescription>
            Enter previous year&apos;s closing balances directly into their respective Balance Sheet
            ledgers (Cash, Bank, Fixed Assets, Debtors, Creditors, Liabilities, Capital, and
            Retained Earnings). Total Opening Debit must equal Total Opening Credit — Retained
            Earnings is never overwritten as a balancing plug.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-gray-600">Opening Balance Date</Label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFromDate(next);
                    if (/^\d{4}-\d{2}-\d{2}$/.test(next)) {
                      void loadAccounts(next);
                    }
                  }}
                  className="w-40 h-8 text-sm"
                />
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Filter accounts…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 w-52 text-sm"
                />
              </div>
            </div>

            <div
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium",
                balanced
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-300 bg-amber-50 text-amber-900"
              )}
            >
              {balanced ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Dr {fmtMoney(totalDebit)} = Cr {fmtMoney(totalCredit)} (Balanced)</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>
                    Dr {fmtMoney(totalDebit)} vs Cr {fmtMoney(totalCredit)} · Difference:{" "}
                    {fmtMoney(Math.abs(difference))} ({difference > 0 ? "Need Credit" : "Need Debit"})
                  </span>
                </>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading Balance Sheet accounts…
            </div>
          ) : (
            <div className="border rounded-lg max-h-[380px] overflow-y-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 bg-gray-50 border-b z-10">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600 w-20">Code</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">Account</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600 w-36">Opening Debit</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600 w-36">Opening Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {TYPE_GROUPS.map((grp) => {
                    const rows = filteredAccounts.filter((a) => a.type === grp.key);
                    if (rows.length === 0) return null;
                    return (
                      <Fragment key={grp.key}>
                        <tr className="bg-slate-100/80 border-y">
                          <td colSpan={4} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                            {grp.label}
                          </td>
                        </tr>
                        {rows.map((acct) => (
                          <tr key={acct.id} className="border-b last:border-b-0 hover:bg-muted/20">
                            <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{acct.code}</td>
                            <td className="px-3 py-1.5 text-sm text-gray-900">{acct.name}</td>
                            <td className="px-3 py-1.5">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                value={debitDrafts[acct.id] ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setDebitDrafts((prev) => ({ ...prev, [acct.id]: v }));
                                  if (v && Number(v) > 0) {
                                    setCreditDrafts((prev) => ({ ...prev, [acct.id]: "" }));
                                  }
                                }}
                                className="h-7 text-right font-mono text-xs tabular-nums"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                value={creditDrafts[acct.id] ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setCreditDrafts((prev) => ({ ...prev, [acct.id]: v }));
                                  if (v && Number(v) > 0) {
                                    setDebitDrafts((prev) => ({ ...prev, [acct.id]: "" }));
                                  }
                                }}
                                className="h-7 text-right font-mono text-xs tabular-nums"
                              />
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                  {filteredAccounts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        No matching Balance Sheet accounts found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={loading || saving || accounts.length === 0}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Opening Balances
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
