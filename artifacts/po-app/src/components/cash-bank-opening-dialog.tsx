import { useEffect, useState } from "react";
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
import { Loader2, Landmark } from "lucide-react";

interface CashBankAccountRow {
  id: number;
  code: string;
  name: string;
  openingBalance: number;
  openingDebit: number;
  openingCredit: number;
}

interface CashBankOpeningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultFromDate?: string;
}

export function CashBankOpeningDialog({
  open,
  onOpenChange,
  defaultFromDate,
}: CashBankOpeningDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [fromDate, setFromDate] = useState(defaultFromDate || "");
  const [accounts, setAccounts] = useState<CashBankAccountRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadAccounts(targetFrom?: string) {
    setLoading(true);
    try {
      const q = targetFrom ? `?from=${encodeURIComponent(targetFrom)}` : "";
      const res = await fetch(`/api/accounting/cash-bank-opening-balances${q}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load Cash & Bank accounts");
      }
      const data = await res.json();
      setFromDate(data.fromDate || targetFrom || "");
      const list: CashBankAccountRow[] = data.accounts || [];
      setAccounts(list);
      const nextDrafts: Record<number, string> = {};
      for (const a of list) {
        nextDrafts[a.id] = a.openingBalance ? a.openingBalance.toFixed(2) : "0.00";
      }
      setDrafts(nextDrafts);
    } catch (err: any) {
      toast({
        title: err?.message || "Failed to load Cash & Bank opening balances",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      void loadAccounts(defaultFromDate || undefined);
    }
  }, [open, defaultFromDate]);

  async function handleSave() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
      toast({ title: "Enter a valid opening date", variant: "destructive" });
      return;
    }

    const entries: Array<{ accountId: number; amount: number }> = [];
    for (const a of accounts) {
      const raw = String(drafts[a.id] ?? "0").replace(/,/g, "").trim();
      const parsed = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(parsed)) {
        toast({
          title: `Invalid amount for ${a.code} ${a.name}`,
          variant: "destructive",
        });
        return;
      }
      entries.push({ accountId: a.id, amount: parsed });
    }

    setSaving(true);
    try {
      const res = await fetch("/api/accounting/cash-bank-opening-balances", {
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
      toast({ title: "Cash & Bank opening balances saved" });
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1E3A5F]">
            <Landmark className="h-5 w-5 text-blue-600" />
            Cash &amp; Bank Opening Balances
          </DialogTitle>
          <DialogDescription>
            Enter previous year&apos;s closing Cash and Bank balances as current year&apos;s opening
            balances. These are recorded in Opening Debit/Credit columns and offset against
            Opening Balance Equity (1090) — never treated as current-year income or expenses.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
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
                className="w-44 h-9 text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground pb-2">
              Use positive values for Debit balances (or negative for Bank Overdraft / Credit).
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading Cash &amp; Bank accounts…
            </div>
          ) : (
            <div className="border rounded-lg divide-y max-h-80 overflow-y-auto">
              {accounts.map((acct) => {
                const val = Number(String(drafts[acct.id] ?? "0").replace(/,/g, "").trim());
                const side = !Number.isFinite(val) || Math.abs(val) < 0.005
                  ? "Zero"
                  : val > 0
                    ? "Opening Dr"
                    : "Opening Cr";
                return (
                  <div key={acct.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        <span className="font-mono text-xs text-gray-500 mr-2">{acct.code}</span>
                        {acct.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-medium text-muted-foreground w-16 text-right">
                        {side}
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        value={drafts[acct.id] ?? "0.00"}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [acct.id]: e.target.value }))
                        }
                        className="w-36 h-8 text-right font-mono text-sm tabular-nums"
                      />
                    </div>
                  </div>
                );
              })}
              {accounts.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No active Cash or Bank accounts found.
                </div>
              )}
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
