import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CreditCard, Loader2, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";

type BillingPlan = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  duration?: string | null;
  durationDays?: number;
  price: number;
  currency: string;
  maxUsers?: number;
};

type BillingStatus = {
  blocked: boolean;
  requiresPurchase: boolean;
  trialExpired: boolean;
  isTrial: boolean;
  reason: string | null;
  daysRemaining: number | null;
  hoursRemaining: number | null;
  expiresAt: string | null;
  plans: BillingPlan[];
  license: {
    status?: string;
    planName?: string | null;
    paymentStatus?: string | null;
  } | null;
};

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-SG", {
      style: "currency",
      currency: currency || "SGD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || "SGD"} ${amount.toFixed(2)}`;
  }
}

/**
 * Full-screen gate after the 1-day free trial.
 * App content stays locked until a plan is purchased.
 */
export function LicensePaywall() {
  const { user, selectedCompany, logout } = useAuth();
  const [location] = useLocation();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [error, setError] = useState("");

  const publicPath =
    location.startsWith("/login")
    || location.startsWith("/register")
    || location.startsWith("/select-company")
    || location.startsWith("/superadmin");

  const load = useCallback(async () => {
    if (!user || !selectedCompany?.id || publicPath) {
      setStatus(null);
      setLoading(false);
      return;
    }
    // Super Admin portal users are not gated by tenant trial.
    if (String(user.role || "").toLowerCase() === "super_admin") {
      setStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/billing/status", { credentials: "include" });
      if (!res.ok) {
        setStatus(null);
        return;
      }
      const data = (await res.json()) as BillingStatus;
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [user, selectedCompany?.id, publicPath]);

  useEffect(() => {
    void load();
    if (publicPath) return;
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load, publicPath]);

  async function purchase(planCode: string) {
    setPurchasing(planCode);
    setError("");
    try {
      const res = await fetch("/api/billing/purchase", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Purchase failed. Please try again.");
        return;
      }
      await load();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPurchasing(null);
    }
  }

  if (loading || !status || !status.blocked || !status.requiresPurchase) {
    return null;
  }

  const plans = status.plans?.length
    ? status.plans
    : [];

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div className="bg-gradient-to-r from-blue-700 to-indigo-700 text-white px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-white/15">
              <Lock className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-tight">
                {status.trialExpired || status.isTrial
                  ? "Your 1-day free trial has ended"
                  : "Subscription required"}
              </h2>
              <p className="text-sm text-blue-100 mt-1">
                {status.reason
                  || "Purchase a plan to continue using BizOne. The application stays locked until a plan is purchased."}
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Free trial starts when you create the account and lasts <strong>1 day</strong>.
            After that you must purchase a plan to open the application again.
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.code}
                className={cn(
                  "rounded-xl border p-4 flex flex-col gap-3",
                  plan.code === "sg_growth" ? "border-blue-500 shadow-md ring-1 ring-blue-200" : "border-slate-200",
                )}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-blue-600" />
                    <h3 className="font-semibold text-slate-900 text-sm">{plan.name}</h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-3">
                    {plan.description || plan.duration || "Annual subscription"}
                  </p>
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">
                    {formatMoney(plan.price, plan.currency)}
                  </div>
                  <div className="text-xs text-slate-500">
                    / {plan.duration || `${plan.durationDays || 365} days`}
                  </div>
                </div>
                <Button
                  className="mt-auto w-full gap-2"
                  disabled={Boolean(purchasing)}
                  onClick={() => void purchase(plan.code)}
                >
                  {purchasing === plan.code ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                  Purchase plan
                </Button>
              </div>
            ))}
          </div>

          {!plans.length ? (
            <div className="text-sm text-slate-600">
              Plans are not available right now. Contact BizOne Support or your Super Administrator.
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 pt-2 border-t">
            <p className="text-xs text-slate-500">
              After purchase the app unlocks immediately. Payment confirmation is handled by Super Admin.
            </p>
            <Button type="button" variant="outline" onClick={() => logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
