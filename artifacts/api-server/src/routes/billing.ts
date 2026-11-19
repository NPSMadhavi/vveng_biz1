import { Router, type IRouter } from "express";
import {
  checkCompanyLicense,
  listPurchasablePlans,
  purchasePlanForCompany,
} from "../lib/superadmin-engine.js";

const router: IRouter = Router();

function requireAuth(req: any, res: any): boolean {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  return true;
}

function requireCompany(req: any, res: any): boolean {
  if (!req.session?.companyId) {
    res.status(400).json({ error: "No company selected" });
    return false;
  }
  return true;
}

/** GET /billing/status — trial / license status for the active company. */
router.get("/billing/status", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  if (!requireCompany(req, res)) return;

  const companyId = req.session.companyId!;
  const check = await checkCompanyLicense(companyId);
  const plans = check.requiresPurchase || !check.allowed
    ? await listPurchasablePlans().catch(() => [])
    : [];

  const license = check.license;
  const isTrial = Boolean(
    check.trialExpired
    || String(license?.plan_code || "").toLowerCase() === "sg_trial"
    || /trial/i.test(String(license?.plan_type || ""))
    || String(license?.payment_status || "").toLowerCase() === "trial",
  );

  res.json({
    companyId,
    allowed: check.allowed,
    blocked: !check.allowed,
    requiresPurchase: Boolean(check.requiresPurchase || !check.allowed),
    trialExpired: Boolean(check.trialExpired),
    isTrial,
    reason: check.reason || null,
    daysRemaining: check.daysRemaining ?? null,
    hoursRemaining: check.hoursRemaining ?? null,
    expiresAt: check.expiresAt || license?.expires_at || null,
    license: license
      ? {
          id: license.id,
          status: license.status,
          planCode: license.plan_code || null,
          planName: license.plan_name || license.plan_type || null,
          paymentStatus: license.payment_status || null,
          expiryDate: license.expiry_date || null,
          expiresAt: license.expires_at || check.expiresAt || null,
        }
      : null,
    plans: plans.map((p: any) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      duration: p.duration,
      durationDays: p.duration_days,
      price: Number(p.price) || 0,
      currency: p.currency || "SGD",
      maxUsers: p.max_users,
    })),
  });
});

/** GET /billing/plans — purchasable plans (always available when logged in). */
router.get("/billing/plans", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  try {
    const plans = await listPurchasablePlans();
    res.json({
      plans: plans.map((p: any) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        duration: p.duration,
        durationDays: p.duration_days,
        price: Number(p.price) || 0,
        currency: p.currency || "SGD",
        maxUsers: p.max_users,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Failed to load plans" });
  }
});

/**
 * POST /billing/purchase { planCode }
 * After free trial, tenant selects a plan. App unlocks immediately; payment marked Pending
 * for Super Admin confirmation.
 */
router.post("/billing/purchase", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  if (!requireCompany(req, res)) return;

  const planCode = String(req.body?.planCode || "").trim();
  if (!planCode) {
    res.status(400).json({ error: "planCode is required" });
    return;
  }

  try {
    const { license, plan } = await purchasePlanForCompany({
      companyId: req.session.companyId!,
      planCode,
      userId: req.session.userId,
      username: req.session.username,
    });
    res.json({
      success: true,
      message: `${plan.name} is now active. Complete payment when invoiced — Super Admin will confirm payment status.`,
      license: {
        id: license.id,
        status: license.status,
        planName: plan.name,
        planCode: plan.code,
        expiryDate: license.expiry_date,
        expiresAt: license.expires_at,
        paymentStatus: license.payment_status,
      },
    });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "Purchase failed" });
  }
});

export default router;
