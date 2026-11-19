import { Router } from "express";
import { db, customersTable, pool } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { softDeleteById } from "../lib/soft-delete.js";

const router = Router();

function pgDetail(err: unknown): string {
  const e = err as { cause?: { detail?: string; message?: string; code?: string }; detail?: string; message?: string };
  return String(e?.cause?.detail || e?.detail || e?.cause?.message || e?.message || "");
}

type AssignedEmployee = { id: number; employeeId: string; name: string };

async function ensureCustomerEmployeesTable(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS customer_employees (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL,
    customer_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS customer_employees_company_customer_employee_idx
     ON customer_employees (company_id, customer_id, employee_id)`,
  );
}

async function ensureUsageType(): Promise<void> {
  await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS usage_type text NOT NULL DEFAULT 'general'`);
}

function parseUsageType(value: unknown): "general" | "manpower" {
  return value === "manpower" ? "manpower" : "general";
}

function parsePerHourAmount(value: unknown): string | null {
  if (value == null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount.toFixed(2);
}

function parseEmployeeIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

async function loadAssignedEmployees(companyId: number): Promise<Map<number, AssignedEmployee[]>> {
  const grouped = new Map<number, AssignedEmployee[]>();
  try {
    await ensureCustomerEmployeesTable();
    const result = await pool.query(
      `SELECT ce.customer_id, e.id, e.employee_id, e.name
       FROM customer_employees ce
       JOIN employees e ON e.id = ce.employee_id AND e.company_id = ce.company_id
       WHERE ce.company_id = $1
         AND COALESCE(e.is_deleted, 0) = 0
       ORDER BY e.name ASC, e.id ASC`,
      [companyId],
    );
    for (const row of result.rows) {
      const customerId = Number(row.customer_id);
      const list = grouped.get(customerId) ?? [];
      list.push({
        id: Number(row.id),
        employeeId: row.employee_id == null ? "" : String(row.employee_id),
        name: String(row.name ?? ""),
      });
      grouped.set(customerId, list);
    }
  } catch (err) {
    console.error("[customers] load assigned employees failed:", err);
  }
  return grouped;
}

async function replaceCustomerEmployees(companyId: number, customerId: number, employeeIds: number[]): Promise<void> {
  await ensureCustomerEmployeesTable();
  await pool.query(
    `DELETE FROM customer_employees WHERE company_id = $1 AND customer_id = $2`,
    [companyId, customerId],
  );
  if (employeeIds.length === 0) return;
  await pool.query(
    `INSERT INTO customer_employees (company_id, customer_id, employee_id)
     SELECT $1, $2, e.id
     FROM employees e
     WHERE e.company_id = $1 AND e.id = ANY($3::int[])`,
    [companyId, customerId, employeeIds],
  );
}

async function ensureCompanyStub(companyId: number): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO companies (id, name, country)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [companyId, `Company ${companyId}`, "Singapore"],
    );
  } catch {
    // Older schemas / missing table — ignore; insert will surface the real error.
  }
}

router.get("/customers", async (req, res) => {
  const companyId = (req.session as any).companyId;
  if (!companyId) return res.status(400).json({ error: "No company selected" });
  try {
    await ensureUsageType();
    const customers = await db.select().from(customersTable)
      .where(and(
        eq(customersTable.companyId, companyId),
        sql`COALESCE(${customersTable.isDeleted}, 0) = 0`,
      ))
      .orderBy(desc(customersTable.createdAt), desc(customersTable.id));
    const assigned = await loadAssignedEmployees(companyId);
    return res.json(customers.map((customer) => ({
      ...customer,
      assignedEmployees: assigned.get(customer.id) ?? [],
    })));
  } catch (e: any) {
    console.error("[customers] list failed:", e?.message || e);
    return res.status(500).json({ error: "Failed to fetch customers" });
  }
});

router.post("/customers", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  const companyId = (req.session as any).companyId;
  if (!companyId) return res.status(400).json({ error: "No company selected" });

  const { name, address, postalCode, country, contactPerson, contactEmail, phone, gstRegistered, gstNo, currency, shipToAddress, quotationTerms, creditLimitEnabled, creditLimit } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  const limitEnabled = creditLimitEnabled === true || creditLimitEnabled === "true" || creditLimitEnabled === 1 || creditLimitEnabled === "1";
  const gstOn = gstRegistered === true || gstRegistered === "true" || gstRegistered === 1 || gstRegistered === "1";
  const parsedLimit = limitEnabled && creditLimit != null && creditLimit !== ""
    ? Number(creditLimit)
    : null;
  const creditLimitValue = parsedLimit != null && Number.isFinite(parsedLimit) && parsedLimit >= 0
    ? String(parsedLimit)
    : null;

  const values = {
    companyId,
    name: String(name).trim(),
    address: address ? String(address).trim() || null : null,
    postalCode: postalCode ? String(postalCode).trim() || null : null,
    country: country ? String(country).trim() || null : null,
    contactPerson: contactPerson ? String(contactPerson).trim() || null : null,
    contactEmail: contactEmail ? String(contactEmail).trim() || null : null,
    phone: phone ? String(phone).trim() || null : null,
    currency: currency ? String(currency).trim() || null : null,
    gstRegistered: gstOn,
    gstNo: gstOn && gstNo && String(gstNo).trim() ? String(gstNo).trim() : null,
    creditLimitEnabled: limitEnabled,
    creditLimit: creditLimitValue,
    shipToAddress: shipToAddress ? String(shipToAddress).trim() || null : null,
    quotationTerms: quotationTerms ? String(quotationTerms).trim() || null : null,
    perHourAmount: parsePerHourAmount(req.body.perHourAmount),
    usageType: parseUsageType(req.body.usageType),
  };

  let customer: typeof customersTable.$inferSelect | undefined;
  try {
    await ensureUsageType();
    const inserted = await db.insert(customersTable).values(values).returning();
    customer = inserted[0];
    const employeeIds = parseEmployeeIds(req.body.employeeIds);
    if (employeeIds) await replaceCustomerEmployees(companyId, customer.id, employeeIds);
    const assigned = employeeIds ? (await loadAssignedEmployees(companyId)).get(customer.id) ?? [] : [];
    return res.status(201).json({ ...customer, assignedEmployees: assigned });
  } catch (e: any) {
    if (customer) {
      console.error("[customers] assign employees failed:", e?.message || e);
      return res.status(500).json({
        error: "Customer was created, but the selected employees could not be assigned. Open the customer and assign them again.",
      });
    }
    const detail = pgDetail(e);
    const msg = String(e?.message || "Failed to create customer");
    console.error("[customers] create failed:", msg, detail);

    // Missing company stub / FK — heal once and retry.
    if (/foreign key|company_id|23503/i.test(`${msg} ${detail}`)) {
      try {
        await ensureCompanyStub(companyId);
        const [customer] = await db.insert(customersTable).values(values).returning();
        const employeeIds = parseEmployeeIds(req.body.employeeIds);
        if (employeeIds) await replaceCustomerEmployees(companyId, customer.id, employeeIds);
        const assigned = employeeIds ? (await loadAssignedEmployees(companyId)).get(customer.id) ?? [] : [];
        return res.status(201).json({ ...customer, assignedEmployees: assigned });
      } catch (retryErr: any) {
        console.error("[customers] create retry failed:", retryErr?.message || retryErr, pgDetail(retryErr));
        return res.status(500).json({
          error: "Company database is out of sync. Log out, sign in again, then retry creating the customer.",
        });
      }
    }

    if (/credit_limit|invalid input syntax|22P02/i.test(`${msg} ${detail}`)) {
      return res.status(400).json({ error: "Invalid credit limit value." });
    }
    if (/does not exist|42703/i.test(`${msg} ${detail}`)) {
      return res.status(500).json({
        error: "Customer table is missing columns. Restart the API server so company database schema can heal, then retry.",
      });
    }

    // Prefer Postgres detail over raw "Failed query: ..." dump
    const friendly = detail && !/^Failed query:/i.test(detail) ? detail : msg;
    return res.status(500).json({
      error: /^Failed query:/i.test(friendly)
        ? "Failed to create customer. Check company database and try again."
        : friendly,
    });
  }
});

router.put("/customers/:id", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  const companyId = (req.session as any).companyId;
  if (!companyId) return res.status(400).json({ error: "No company selected" });

  const id = parseInt(req.params.id);
  const { name, address, postalCode, country, contactPerson, contactEmail, phone, gstRegistered, gstNo, isActive, currency, shipToAddress, quotationTerms, creditLimitEnabled, creditLimit } = req.body;

  const limitEnabled = creditLimitEnabled === true || creditLimitEnabled === "true" || creditLimitEnabled === 1 || creditLimitEnabled === "1";
  const gstOn = gstRegistered === true || gstRegistered === "true" || gstRegistered === 1 || gstRegistered === "1";
  const parsedLimit = limitEnabled && creditLimit != null && creditLimit !== ""
    ? Number(creditLimit)
    : null;
  const creditLimitValue = parsedLimit != null && Number.isFinite(parsedLimit) && parsedLimit >= 0
    ? String(parsedLimit)
    : null;

  try {
    await ensureUsageType();
    const [customer] = await db.update(customersTable).set({
      name,
      address: address || null,
      postalCode: postalCode || null,
      country: country || null,
      contactPerson: contactPerson || null,
      contactEmail: contactEmail || null,
      phone: phone || null,
      currency: currency || null,
      gstRegistered: gstOn,
      gstNo: gstOn && gstNo ? String(gstNo) : null,
      creditLimitEnabled: limitEnabled,
      creditLimit: creditLimitValue,
      shipToAddress: shipToAddress || null,
      quotationTerms: quotationTerms !== undefined ? (quotationTerms || null) : undefined,
      perHourAmount: parsePerHourAmount(req.body.perHourAmount),
      usageType: req.body.usageType === undefined ? undefined : parseUsageType(req.body.usageType),
      isActive: isActive !== undefined ? Boolean(isActive) : undefined,
    }).where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId))).returning();

    if (!customer) return res.status(404).json({ error: "Customer not found" });
    const employeeIds = parseEmployeeIds(req.body.employeeIds);
    if (employeeIds) await replaceCustomerEmployees(companyId, customer.id, employeeIds);
    const assigned = (await loadAssignedEmployees(companyId)).get(customer.id) ?? [];
    return res.json({ ...customer, assignedEmployees: assigned });
  } catch (e: any) {
    console.error("[customers] update failed:", e?.message || e);
    return res.status(500).json({ error: e?.message || "Failed to update customer" });
  }
});

router.put("/customers/:id/employees", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  const companyId = (req.session as any).companyId;
  if (!companyId) return res.status(400).json({ error: "No company selected" });

  const id = parseInt(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid customer" });
  const employeeIds = parseEmployeeIds(req.body.employeeIds) ?? [];

  try {
    const existing = await db.select({ id: customersTable.id }).from(customersTable)
      .where(and(eq(customersTable.id, id), eq(customersTable.companyId, companyId)));
    if (!existing[0]) return res.status(404).json({ error: "Customer not found" });
    await replaceCustomerEmployees(companyId, id, employeeIds);
    const assigned = (await loadAssignedEmployees(companyId)).get(id) ?? [];
    return res.json({ assignedEmployees: assigned });
  } catch (e: any) {
    console.error("[customers] assign employees failed:", e?.message || e);
    return res.status(500).json({ error: "Failed to assign employees" });
  }
});

router.delete("/customers/:id", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  const companyId = (req.session as any).companyId;
  if (!companyId) return res.status(400).json({ error: "No company selected" });

  const id = parseInt(req.params.id);
  try {
    const ok = await softDeleteById(pool, "customers", { id, companyId });
    if (!ok) return res.status(404).json({ error: "Customer not found" });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete customer" });
  }
});

export default router;
