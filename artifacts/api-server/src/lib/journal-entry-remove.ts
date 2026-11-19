/**
 * Remove journal entries from statements without posting a VOID/reverse JE.
 * Soft-deletes the original row(s) and any linked reversal rows.
 */
import { db, journalEntriesTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

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
