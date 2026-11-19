/**
 * Remove journal entries from statements without posting a VOID/reverse JE.
 * Soft-deletes the original row(s) and any linked reversal rows.
 */
import { db, journalEntriesTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

export async function removeJournalEntriesForRef(opts: {
  companyId: number;
  refType: string;
  refId: number;
  /** Extra ref_types that may hold a linked reversal (e.g. asset_disposal_reversal). */
  alsoRefTypes?: string[];
  log?: any;
}): Promise<number> {
  const { companyId, refType, refId, alsoRefTypes = [], log } = opts;

  try {
    const refTypes = [refType, ...alsoRefTypes];
    const related: Array<{ id: number; reversalOfId: number | null }> = [];

    for (const rt of refTypes) {
      const rows = await db
        .select({
          id: journalEntriesTable.id,
          reversalOfId: journalEntriesTable.reversalOfId,
        })
        .from(journalEntriesTable)
        .where(
          and(
            eq(journalEntriesTable.companyId, companyId),
            eq(journalEntriesTable.refType, rt),
            eq(journalEntriesTable.refId, refId),
          ),
        );
      related.push(...rows);
    }

    if (related.length === 0) return 0;

    const ids = new Set(related.map((r) => r.id));
    const originals = related.filter((r) => !r.reversalOfId).map((r) => r.id);

    if (originals.length > 0) {
      const reversals = await db
        .select({ id: journalEntriesTable.id })
        .from(journalEntriesTable)
        .where(inArray(journalEntriesTable.reversalOfId, originals));
      for (const r of reversals) ids.add(r.id);
    }

    const idList = [...ids];
    await db
      .update(journalEntriesTable)
      .set({ isDeleted: 1, status: "reversed" })
      .where(inArray(journalEntriesTable.id, idList));

    return idList.length;
  } catch (err) {
    if (log) log.error({ err, refType, refId }, "journal-entry-remove: failed (non-fatal)");
    return 0;
  }
}

/**
 * Hide posted journals whose source voucher was deleted, voided, or no longer exists.
 * Statement pages call this before any backfill so a deleted voucher cannot be posted again.
 */
export async function hideJournalsForDeletedSources(companyId: number): Promise<void> {
  await db.execute(sql`
    UPDATE journal_entries je
    SET is_deleted = 1,
        status = 'reversed'
    WHERE je.company_id = ${companyId}
      AND COALESCE(je.is_deleted, 0) = 0
      AND je.reversal_of_id IS NULL
      AND COALESCE(je.ref_type, '') NOT IN ('manual', 'fy_opening', 'ledger_ob_adjust')
      AND (
        (je.ref_type = 'payroll' AND NOT EXISTS (
          SELECT 1 FROM payroll_records pr
          WHERE pr.id = je.ref_id AND pr.company_id = je.company_id
        ))
        OR (je.ref_type = 'expense' AND NOT EXISTS (
          SELECT 1 FROM expenses e
          WHERE e.id = je.ref_id AND e.company_id = je.company_id
            AND COALESCE(e.is_deleted, 0) = 0
            AND e.status = 'confirmed'
        ))
        OR (je.ref_type = 'income_record' AND NOT EXISTS (
          SELECT 1 FROM income_records i
          WHERE i.id = je.ref_id AND i.company_id = je.company_id
            AND COALESCE(i.is_deleted, 0) = 0
            AND i.status = 'confirmed'
        ))
        OR (je.ref_type = 'invoice' AND NOT EXISTS (
          SELECT 1 FROM invoices i
          WHERE i.id = je.ref_id AND i.company_id = je.company_id
            AND COALESCE(i.is_deleted, 0) = 0
            AND lower(COALESCE(i.status, '')) NOT IN ('draft', 'void', 'cancelled')
        ))
        OR (je.ref_type = 'vendor_invoice' AND NOT EXISTS (
          SELECT 1 FROM vendor_invoices v
          WHERE v.id = je.ref_id AND v.company_id = je.company_id
            AND COALESCE(v.is_deleted, 0) = 0
            AND lower(COALESCE(v.status, '')) NOT IN ('draft', 'void', 'cancelled')
        ))
        OR (je.ref_type = 'invoice_payment' AND NOT EXISTS (
          SELECT 1 FROM invoice_payments p
          WHERE p.id = je.ref_id AND p.company_id = je.company_id
        ))
        OR (je.ref_type = 'vendor_payment' AND NOT EXISTS (
          SELECT 1 FROM vendor_payments p
          WHERE p.id = je.ref_id AND p.company_id = je.company_id
        ))
        OR (je.ref_type = 'asset_depreciation' AND NOT EXISTS (
          SELECT 1 FROM assets a
          WHERE a.id = je.ref_id AND a.company_id = je.company_id
        ))
        OR (je.ref_type = 'asset_disposal' AND NOT EXISTS (
          SELECT 1 FROM assets a
          WHERE a.id = je.ref_id AND a.company_id = je.company_id
            AND lower(COALESCE(a.status, '')) IN ('disposed', 'retired')
        ))
      )
  `);
}
