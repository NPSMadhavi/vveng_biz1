import { Router } from "express";
import { db, pool, vendorsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

async function ensureUsageType(): Promise<void> {
  await pool.query(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS usage_type text NOT NULL DEFAULT 'general'`);
}

function parseUsageType(value: unknown): "general" | "manpower" {
  return value === "manpower" ? "manpower" : "general";
}

router.get("/vendors", async (req, res) => {
  const companyId = (req.session as any).companyId;
  if (!companyId) return res.status(400).json({ error: "No company selected" });
  try {
    await ensureUsageType();
    const vendors = await db.select().from(vendorsTable)
      .where(eq(vendorsTable.companyId, companyId))
      .orderBy(desc(vendorsTable.createdAt), desc(vendorsTable.id));
    return res.json(vendors);
  } catch {
    return res.status(500).json({ error: "Failed to fetch vendors" });
  }
});

router.post("/vendors", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  const companyId = (req.session as any).companyId;
  if (!companyId) return res.status(400).json({ error: "No company selected" });

  const { name, address, postalCode, country, contactPerson, contactEmail, phone, gstRegistered, gstNo, currency } = req.body;
  if (!name) return res.status(400).json({ error: "Name is required" });

  try {
    await ensureUsageType();
    const [vendor] = await db.insert(vendorsTable).values({
      companyId,
      name,
      address: address || null,
      postalCode: postalCode || null,
      country: country || null,
      contactPerson: contactPerson || null,
      contactEmail: contactEmail || null,
      phone: phone || null,
      currency: currency || null,
      gstRegistered: Boolean(gstRegistered),
      gstNo: gstRegistered && gstNo ? gstNo : null,
      usageType: parseUsageType(req.body.usageType),
    }).returning();
    return res.status(201).json(vendor);
  } catch {
    return res.status(500).json({ error: "Failed to create vendor" });
  }
});

router.put("/vendors/:id", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  const companyId = (req.session as any).companyId;
  if (!companyId) return res.status(400).json({ error: "No company selected" });

  const id = parseInt(req.params.id);
  const { name, address, postalCode, country, contactPerson, contactEmail, phone, gstRegistered, gstNo, isActive, currency } = req.body;

  try {
    await ensureUsageType();
    const [vendor] = await db.update(vendorsTable).set({
      name,
      address: address || null,
      postalCode: postalCode || null,
      country: country || null,
      contactPerson: contactPerson || null,
      contactEmail: contactEmail || null,
      phone: phone || null,
      currency: currency || null,
      gstRegistered: Boolean(gstRegistered),
      gstNo: gstRegistered && gstNo ? gstNo : null,
      usageType: req.body.usageType === undefined ? undefined : parseUsageType(req.body.usageType),
      isActive: isActive !== undefined ? Boolean(isActive) : undefined,
    }).where(and(eq(vendorsTable.id, id), eq(vendorsTable.companyId, companyId))).returning();

    if (!vendor) return res.status(404).json({ error: "Vendor not found" });
    return res.json(vendor);
  } catch {
    return res.status(500).json({ error: "Failed to update vendor" });
  }
});

router.delete("/vendors/:id", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  const companyId = (req.session as any).companyId;
  if (!companyId) return res.status(400).json({ error: "No company selected" });

  const id = parseInt(req.params.id);
  try {
    await db.delete(vendorsTable).where(and(eq(vendorsTable.id, id), eq(vendorsTable.companyId, companyId)));
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete vendor" });
  }
});

export default router;
