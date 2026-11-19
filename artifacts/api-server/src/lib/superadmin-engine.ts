import pg from "pg";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { masterPool, APP_ALL_MODULES } from "@workspace/db";
import { logger } from "./logger.js";
import { setLoginPasswordHash } from "./login-password.js";

export function generateLicenseKey(prefix = "BIZ-SG"): string {
  const seg1 = crypto.randomBytes(2).toString("hex").toUpperCase();
  const seg2 = crypto.randomBytes(2).toString("hex").toUpperCase();
  const seg3 = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `${prefix}-${seg1}-${seg2}-${seg3}`;
}

export function computeExpiryStatus(expiryDateStr: string | Date, status: string): string {
  if (status === "Suspended" || status === "Revoked" || status === "Pending") {
    return status;
  }
  const expiry = new Date(expiryDateStr);
  const now = new Date();
  // Strip time for clean date comparison
  const expDateOnly = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  const todayDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (expDateOnly.getTime() < todayDateOnly.getTime()) {
    return "Expired";
  }
  return "Active";
}

export async function logSuperAdminAction(options: {
  userId?: number | null;
  username?: string;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  details?: Record<string, any>;
  req?: any;
}): Promise<void> {
  const { userId, username = "superadmin", action, entityType, entityId, details = {}, req } = options;
  const ipAddress = req?.headers?.["x-forwarded-for"] || req?.socket?.remoteAddress || null;

  try {
    await masterPool.query(
      `INSERT INTO superadmin_audit_logs (
        user_id, username, action, entity_type, entity_id, details, ip_address, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        userId || null,
        username,
        action,
        entityType,
        entityId != null ? String(entityId) : null,
        JSON.stringify(details),
        ipAddress ? String(ipAddress).slice(0, 45) : null,
      ],
    );
  } catch (err: any) {
    logger.warn({ err: err?.message, action }, "[superadmin-audit] Failed to record audit log");
  }
}

export async function ensureSuperAdminSchema(pool: pg.Pool = masterPool): Promise<void> {
  // 1. Ensure master tables exist
  await pool.query(`
    -- Companies enhancements
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Active';
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS notes TEXT;

    -- Subscription Plans
    CREATE TABLE IF NOT EXISTS superadmin_plans (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      description TEXT,
      duration TEXT NOT NULL DEFAULT 'Yearly',
      duration_days INTEGER NOT NULL DEFAULT 365,
      price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      currency TEXT NOT NULL DEFAULT 'SGD',
      max_users INTEGER NOT NULL DEFAULT 5,
      modules JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Licenses
    CREATE TABLE IF NOT EXISTS superadmin_licenses (
      id SERIAL PRIMARY KEY,
      license_key TEXT NOT NULL UNIQUE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES superadmin_plans(id) ON DELETE SET NULL,
      plan_type TEXT NOT NULL DEFAULT 'Standard',
      purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
      expiry_date DATE NOT NULL,
      is_renewable BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'Active',
      payment_status TEXT NOT NULL DEFAULT 'Paid',
      max_users INTEGER NOT NULL DEFAULT 5,
      enabled_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_superadmin_licenses_company ON superadmin_licenses(company_id);
    CREATE INDEX IF NOT EXISTS idx_superadmin_licenses_status ON superadmin_licenses(status);
    CREATE INDEX IF NOT EXISTS idx_superadmin_licenses_expiry ON superadmin_licenses(expiry_date);

    -- Renewals History
    CREATE TABLE IF NOT EXISTS superadmin_license_renewals (
      id SERIAL PRIMARY KEY,
      license_id INTEGER NOT NULL REFERENCES superadmin_licenses(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      previous_expiry_date DATE NOT NULL,
      new_expiry_date DATE NOT NULL,
      renewal_date DATE NOT NULL DEFAULT CURRENT_DATE,
      payment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      payment_status TEXT NOT NULL DEFAULT 'Paid',
      payment_reference TEXT,
      notes TEXT,
      renewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_superadmin_renewals_license ON superadmin_license_renewals(license_id);
    CREATE INDEX IF NOT EXISTS idx_superadmin_renewals_company ON superadmin_license_renewals(company_id);

    -- Audit Logs
    CREATE TABLE IF NOT EXISTS superadmin_audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT NOT NULL DEFAULT 'superadmin',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_created ON superadmin_audit_logs(created_at DESC);
  `);

  // 2. Seed Default Plans if table is empty
  const plansCheck = await pool.query("SELECT count(*)::int as count FROM superadmin_plans");
  if ((plansCheck.rows[0]?.count ?? 0) === 0) {
    logger.info("[superadmin-engine] Seeding default Singapore ERP subscription plans...");
    const coreModules = [
      "dashboard", "invoices", "quotations", "sales_orders", "purchase_orders", "purchase_quotations",
      "vendors", "customers", "address_book", "accounting_coa", "accounting_je", "accounting_gl",
      "accounting_tb", "accounting_bs", "accounting_pl", "report_templates"
    ];
    const growthModules = [
      ...coreModules,
      "delivery_orders", "proforma_invoices", "credit_notes", "debit_notes", "grn", "stock_items",
      "warehouses", "stock_transfer", "inventory_reports", "accounting_bank_recon", "accounting_gst_f5",
      "accounting_gst_f7", "accounting_gst_io", "accounting_wht", "accounting_ar", "accounting_ap",
      "point_of_sale", "pos_retail", "pos_supermarket", "pos_reports"
    ];

    const defaultPlans = [
      {
        name: "Starter ERP (SG)",
        code: "sg_starter",
        description: "Essential Singapore accounting, billing, and quotes for startups and micro-enterprises.",
        duration: "Yearly",
        durationDays: 365,
        price: 588.00,
        currency: "SGD",
        maxUsers: 3,
        modules: coreModules,
      },
      {
        name: "Professional Growth (SG)",
        code: "sg_growth",
        description: "Full-suite accounting, Singapore GST F5/F7, multi-location inventory, POS, and sales operations.",
        duration: "Yearly",
        durationDays: 365,
        price: 1548.00,
        currency: "SGD",
        maxUsers: 10,
        modules: growthModules,
      },
      {
        name: "Enterprise Singapore Suite",
        code: "sg_enterprise",
        description: "Unlimited power: Singapore GST, multi-price level, POS retail/F&B, Payroll & IR8A, Projects, WMS.",
        duration: "Yearly",
        durationDays: 365,
        price: 3588.00,
        currency: "SGD",
        maxUsers: -1, // Unlimited
        modules: APP_ALL_MODULES,
      },
      {
        name: "Trial / Evaluation (1 Day)",
        code: "sg_trial",
        description: "Complimentary 1-day full access trial from account creation. Purchase a plan after the trial to continue.",
        duration: "Custom",
        durationDays: 1,
        price: 0.00,
        currency: "SGD",
        maxUsers: 5,
        modules: APP_ALL_MODULES,
      },
    ];

    for (const p of defaultPlans) {
      await pool.query(
        `INSERT INTO superadmin_plans (
          name, code, description, duration, duration_days, price, currency, max_users, modules, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
        ON CONFLICT (code) DO NOTHING`,
        [p.name, p.code, p.description, p.duration, p.durationDays, p.price, p.currency, p.maxUsers, JSON.stringify(p.modules)],
      );
    }
  }

  // Keep trial plan at 1 day even if it was seeded earlier as 30 days.
  await pool.query(
    `UPDATE superadmin_plans
     SET name = 'Trial / Evaluation (1 Day)',
         description = 'Complimentary 1-day full access trial from account creation. Purchase a plan after the trial to continue.',
         duration_days = 1,
         updated_at = NOW()
     WHERE code = 'sg_trial'`,
  );

  // Precise trial/subscription end timestamp (24h-accurate for 1-day trial).
  await pool.query(`
    ALTER TABLE superadmin_licenses
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
  `);
  await pool.query(`
    UPDATE superadmin_licenses
    SET expires_at = (expiry_date::timestamp + INTERVAL '1 day' - INTERVAL '1 second')
    WHERE expires_at IS NULL AND expiry_date IS NOT NULL
  `);

    // 3. Seed / Ensure Initial Super Admin user
  const envUsername = (process.env.SUPERADMIN_USERNAME || "superadmin").trim().toLowerCase();
  const envEmail = (process.env.SUPERADMIN_EMAIL || "superadmin@bizone.sg").trim().toLowerCase();
  const rawPassword = process.env.SUPERADMIN_PASSWORD || "SuperAdmin@2026!";
  const passwordHash = await bcrypt.hash(rawPassword, 10);

  const saCheck = await pool.query(
    "SELECT id, username, email FROM users WHERE LOWER(role) = 'super_admin' OR username = 'superadmin' OR LOWER(username) = $1 OR LOWER(email) = $2 LIMIT 1",
    [envUsername, envEmail]
  );

  let saUserId: number;
  if (!saCheck.rows[0]) {
    const insertUser = await pool.query(
      `INSERT INTO users (
        username, role, email, full_name, phone_number, is_active, created_at, updated_at
      ) VALUES ($1, 'super_admin', $2, 'BizOne Super Administrator', '+65 6221 0000', TRUE, NOW(), NOW())
      RETURNING id`,
      [envUsername, envEmail],
    );
    const saUser = insertUser.rows[0];
    saUserId = saUser.id;
    await setLoginPasswordHash(saUserId, passwordHash);
    logger.info({ username: envUsername, email: envEmail }, "[superadmin-engine] Initial Super Admin account created successfully.");

    await logSuperAdminAction({
      userId: saUserId,
      username: envUsername,
      action: "superadmin_account_initialized",
      entityType: "user",
      entityId: saUserId,
      details: { email: envEmail, note: "Initial system-created Super Admin" },
    });
  } else {
    saUserId = saCheck.rows[0].id;
    await setLoginPasswordHash(saUserId, passwordHash);
    await pool.query(
      `UPDATE users SET 
        username = $1,
        email = $2,
        role = 'super_admin',
        is_active = TRUE,
        updated_at = NOW()
       WHERE id = $3`,
      [envUsername, envEmail, saUserId]
    );
  }

  // 4. Backfill baseline licenses for any existing registered companies without a license record
  const unassignedCompanies = await pool.query(`
    SELECT c.id, c.name, c.created_at
    FROM companies c
    LEFT JOIN superadmin_licenses l ON l.company_id = c.id
    WHERE l.id IS NULL
  `);

  if (unassignedCompanies.rows.length > 0) {
    const trialPlan = (await pool.query("SELECT * FROM superadmin_plans WHERE code = 'sg_trial' LIMIT 1")).rows[0];
    const planId = trialPlan?.id || null;
    const planType = trialPlan?.name || "Trial / Evaluation (30 Days)";
    const modules = trialPlan?.modules || APP_ALL_MODULES;

    for (const comp of unassignedCompanies.rows) {
      const key = generateLicenseKey("BIZ-SG");
      const purchaseDate = new Date(comp.created_at || Date.now());
      // Give 365 days from creation or today
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);

      await pool.query(
        `INSERT INTO superadmin_licenses (
          license_key, company_id, plan_id, plan_type, purchase_date, expiry_date,
          is_renewable, status, payment_status, max_users, enabled_modules, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'Active', 'Paid', 10, $7, 'Auto-assigned active baseline license')`,
        [key, comp.id, planId, planType, purchaseDate.toISOString().slice(0, 10), expiryDate.toISOString().slice(0, 10), JSON.stringify(modules)],
      );
    }
    logger.info({ count: unassignedCompanies.rows.length }, "[superadmin-engine] Baseline licenses assigned to existing companies.");
  }
}

/**
 * Automatically assigns a fresh trial license upon company registration
 */
export async function autoAssignSignupLicense(companyId: number, adminUserId?: number, companyName?: string): Promise<any> {
  try {
    await ensureSuperAdminSchema(masterPool);

    const trialPlan = (await masterPool.query("SELECT * FROM superadmin_plans WHERE code = 'sg_trial' LIMIT 1")).rows[0];
    const planId = trialPlan?.id || null;
    const planType = trialPlan?.name || "Trial / Evaluation (1 Day)";
    const durationDays = Number(trialPlan?.duration_days) > 0 ? Number(trialPlan.duration_days) : 1;
    const maxUsers = trialPlan?.max_users || 5;
    const modules = trialPlan?.modules || APP_ALL_MODULES;

    const licenseKey = generateLicenseKey("BIZ-SG-NEW");
    const purchaseDate = new Date();
    const expiresAt = new Date(purchaseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const expiryDate = expiresAt.toISOString().slice(0, 10);

    const ins = await masterPool.query(
      `INSERT INTO superadmin_licenses (
        license_key, company_id, plan_id, plan_type, purchase_date, expiry_date, expires_at,
        is_renewable, status, payment_status, max_users, enabled_modules, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'Active', 'Trial', $8, $9, 'Automatic registration 1-day trial license', $10)
      RETURNING *`,
      [
        licenseKey,
        companyId,
        planId,
        planType,
        purchaseDate.toISOString().slice(0, 10),
        expiryDate,
        expiresAt.toISOString(),
        maxUsers,
        JSON.stringify(modules),
        adminUserId || null,
      ],
    );

    const license = ins.rows[0];

    await logSuperAdminAction({
      userId: adminUserId,
      username: "system_signup",
      action: "company_signup_license_assigned",
      entityType: "license",
      entityId: license.id,
      details: { companyId, companyName, licenseKey, planType, expiryDate: license.expiry_date },
    });

    return license;
  } catch (err: any) {
    logger.error({ err: err?.message, companyId }, "[superadmin-engine] Failed to auto-assign signup license");
    return null;
  }
}

/**
 * Middleware: Verify if tenant company's license is active
 */
export async function checkCompanyLicense(companyId: number): Promise<{
  allowed: boolean;
  license?: any;
  reason?: string;
  daysRemaining?: number;
  hoursRemaining?: number;
  trialExpired?: boolean;
  requiresPurchase?: boolean;
  expiresAt?: string | null;
}> {
  try {
    const res = await masterPool.query(
      `SELECT l.*, p.code AS plan_code, p.name AS plan_name, p.price AS plan_price, p.currency AS plan_currency
       FROM superadmin_licenses l
       LEFT JOIN superadmin_plans p ON p.id = l.plan_id
       WHERE l.company_id = $1
       ORDER BY COALESCE(l.expires_at, l.expiry_date::timestamptz) DESC, l.id DESC
       LIMIT 1`,
      [companyId],
    );
    const license = res.rows[0];
    if (!license) {
      // No license → must purchase (new accounts always get a trial on register).
      return {
        allowed: false,
        reason: "No active subscription found. Please purchase a plan to continue using BizOne.",
        requiresPurchase: true,
        trialExpired: true,
        daysRemaining: 0,
        hoursRemaining: 0,
      };
    }

    const endsAt = license.expires_at
      ? new Date(license.expires_at)
      : new Date(`${String(license.expiry_date).slice(0, 10)}T23:59:59`);
    const now = new Date();
    const msRemaining = endsAt.getTime() - now.getTime();
    const hoursRemaining = Math.ceil(msRemaining / (1000 * 60 * 60));
    const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
    const isExpiredByTime = msRemaining <= 0;
    const currentStatus = isExpiredByTime && license.status === "Active"
      ? "Expired"
      : computeExpiryStatus(license.expiry_date, license.status);

    if (currentStatus === "Expired" && license.status === "Active") {
      await masterPool.query(
        "UPDATE superadmin_licenses SET status = 'Expired', updated_at = NOW() WHERE id = $1",
        [license.id],
      );
      license.status = "Expired";
    }

    if (license.status === "Suspended") {
      return {
        allowed: false,
        license,
        reason: "Your company BizOne account and license have been suspended by the administrator. Please contact BizOne Support.",
        daysRemaining,
        hoursRemaining,
        expiresAt: endsAt.toISOString(),
        requiresPurchase: true,
      };
    }

    if (license.status === "Revoked") {
      return {
        allowed: false,
        license,
        reason: "Your company BizOne license has been revoked. Please contact BizOne Support.",
        daysRemaining,
        hoursRemaining,
        expiresAt: endsAt.toISOString(),
        requiresPurchase: true,
      };
    }

    // Trial or paid plan expired → block immediately and require purchase (no grace period).
    if (license.status === "Expired" || isExpiredByTime) {
      const wasTrial = String(license.plan_code || "").toLowerCase() === "sg_trial"
        || /trial/i.test(String(license.plan_type || ""))
        || String(license.payment_status || "").toLowerCase() === "trial";
      return {
        allowed: false,
        license,
        reason: wasTrial
          ? "Your 1-day free trial has ended. Purchase a plan to continue using BizOne."
          : `Your BizOne subscription expired on ${license.expiry_date}. Purchase or renew a plan to continue.`,
        daysRemaining: Math.min(0, daysRemaining),
        hoursRemaining: Math.min(0, hoursRemaining),
        expiresAt: endsAt.toISOString(),
        trialExpired: wasTrial,
        requiresPurchase: true,
      };
    }

    return {
      allowed: true,
      license,
      daysRemaining,
      hoursRemaining,
      expiresAt: endsAt.toISOString(),
      trialExpired: false,
      requiresPurchase: false,
    };
  } catch (err: any) {
    logger.warn({ err: err?.message, companyId }, "[superadmin-engine] License verification check bypassed on error");
    return { allowed: true };
  }
}

/** Paid plans available for tenant self-serve purchase (excludes trial). */
export async function listPurchasablePlans(): Promise<any[]> {
  await ensureSuperAdminSchema(masterPool);
  const res = await masterPool.query(
    `SELECT id, name, code, description, duration, duration_days, price, currency, max_users, modules
     FROM superadmin_plans
     WHERE is_active = TRUE AND code <> 'sg_trial'
     ORDER BY price ASC, id ASC`,
  );
  return res.rows;
}

/**
 * Tenant purchases a paid plan after trial.
 * Activates immediately so the app unlocks; payment_status stays Pending until Super Admin confirms.
 */
export async function purchasePlanForCompany(opts: {
  companyId: number;
  planCode: string;
  userId?: number;
  username?: string;
}): Promise<{ license: any; plan: any }> {
  await ensureSuperAdminSchema(masterPool);
  const planRes = await masterPool.query(
    `SELECT * FROM superadmin_plans WHERE code = $1 AND is_active = TRUE LIMIT 1`,
    [opts.planCode],
  );
  const plan = planRes.rows[0];
  if (!plan || plan.code === "sg_trial") {
    throw new Error("Invalid plan selected");
  }

  const durationDays = Number(plan.duration_days) > 0 ? Number(plan.duration_days) : 365;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const licenseKey = generateLicenseKey("BIZ-SG-BUY");

  // Expire any currently Active licenses for this company.
  await masterPool.query(
    `UPDATE superadmin_licenses
     SET status = 'Expired', updated_at = NOW()
     WHERE company_id = $1 AND status = 'Active'`,
    [opts.companyId],
  );

  const ins = await masterPool.query(
    `INSERT INTO superadmin_licenses (
      license_key, company_id, plan_id, plan_type, purchase_date, expiry_date, expires_at,
      is_renewable, status, payment_status, max_users, enabled_modules, notes, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7, TRUE, 'Active', 'Pending', $8, $9, $10, $11)
    RETURNING *`,
    [
      licenseKey,
      opts.companyId,
      plan.id,
      plan.name,
      now.toISOString().slice(0, 10),
      expiresAt.toISOString().slice(0, 10),
      expiresAt.toISOString(),
      plan.max_users,
      JSON.stringify(plan.modules || APP_ALL_MODULES),
      `Self-serve purchase of ${plan.name} after trial`,
      opts.userId || null,
    ],
  );

  const license = ins.rows[0];
  await logSuperAdminAction({
    userId: opts.userId,
    username: opts.username || "tenant_purchase",
    action: "tenant_plan_purchased",
    entityType: "license",
    entityId: license.id,
    details: {
      companyId: opts.companyId,
      planCode: plan.code,
      planName: plan.name,
      price: plan.price,
      currency: plan.currency,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return { license, plan };
}

