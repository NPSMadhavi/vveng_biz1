/**
 * income-auto-post.ts
 *
 * Accrual-basis journal entries for the Income module (non-trade income).
 * Singapore IRAS-aligned — standard-rated, zero-rated, exempt, out-of-scope.
 *
 * ON INCOME CONFIRMED (standard-rated):
 *   DR 1010 Cash at Bank - SGD     = amount + gstAmount  → cash received
 *   CR <revenue account>           = amount              → income recognised
 *   CR 2010 GST Output Tax Payable = gstAmount           → output tax liability
 *
 * ON INCOME CONFIRMED (zero-rated / exempt / out-of-scope — no GST leg):
 *   DR 1010 Cash at Bank - SGD     = amount
 *   CR <revenue account>           = amount
 *
 * ON INCOME VOIDED → reverse the JE
 *
 * All functions are idempotent (safe to call multiple times).
 */

import { db, accountsTable, journalEntriesTable, journalLinesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ensureAccountsSeeded } from "./accounts-seed.js";
import { assertPeriodWritable } from "./financial-year.js";

async function getAccountByCode(companyId: number, code: string) {
  const [acct] = await db.select()
    .from(accountsTable)
    .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.code, code)))
    .limit(1);
  return acct ?? null;
}

async function getAccountById(id: number) {
  const [acct] = await db.select().from(accountsTable).where(eq(accountsTable.id, id)).limit(1);
  return acct ?? null;
}

// ── Income Confirmed ──────────────────────────────────────────────────────────

export async function postIncomeJE(
  income: {
    id: number;
    companyId: number;
    incomeDate: string;
    description: string;
    amount: number | string;
    gstAmount: number | string;
    gstTreatment: string;
    accountId?: number | null;
  },
  userId: number,
  log?: any,
): Promise<void> {
  await ensureAccountsSeeded(income.companyId);

  const periodCheck = await assertPeriodWritable(income.companyId, income.incomeDate);
  if (!periodCheck.ok) throw new Error(periodCheck.error);

  // Idempotency check
  const [existing] = await db.select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.companyId, income.companyId),
      eq(journalEntriesTable.refType, "income_record"),
      eq(journalEntriesTable.refId, income.id),
    ))
    .limit(1);
  if (existing) return;

  const bankAcct = await getAccountByCode(income.companyId, "1010");
  // Fall back to account 4200 (Other Operating Revenue) if no accountId given
  const revenueAcct = income.accountId
    ? await getAccountById(income.accountId)
    : await getAccountByCode(income.companyId, "4200");

  if (!bankAcct || !revenueAcct) {
    if (log) log.warn({ companyId: income.companyId }, "income-auto-post: bank or revenue account not found");
    return;
  }

  const net        = parseFloat(String(income.amount)).toFixed(2);
  const gst        = parseFloat(String(income.gstAmount ?? 0)).toFixed(2);
  const gross      = (parseFloat(net) + parseFloat(gst)).toFixed(2);
  const isStdRated = income.gstTreatment === "standard_rated" && parseFloat(gst) > 0;
  const desc       = income.description;

  try {
    const [entry] = await db.insert(journalEntriesTable).values({
      companyId:   income.companyId,
      entryDate:   income.incomeDate,
      description: desc,
      refType:     "income_record",
      refId:       income.id,
      refNumber:   `INC-${income.id}`,
      status:      "posted",
      createdBy:   userId,
    }).returning();

    if (isStdRated) {
      const gstAcct = await getAccountByCode(income.companyId, "2010");
      if (!gstAcct) {
        if (log) log.warn({ companyId: income.companyId }, "income-auto-post: GST output account 2010 not found");
        return;
      }
      await db.insert(journalLinesTable).values([
        { journalEntryId: entry.id, accountId: bankAcct.id,    description: desc, debit: gross, credit: "0.00" },
        { journalEntryId: entry.id, accountId: revenueAcct.id, description: desc, debit: "0.00", credit: net   },
        { journalEntryId: entry.id, accountId: gstAcct.id,     description: desc, debit: "0.00", credit: gst   },
      ]);
    } else {
      await db.insert(journalLinesTable).values([
        { journalEntryId: entry.id, accountId: bankAcct.id,    description: desc, debit: net,   credit: "0.00" },
        { journalEntryId: entry.id, accountId: revenueAcct.id, description: desc, debit: "0.00", credit: net   },
      ]);
    }
  } catch (err) {
    if (log) log.error({ err, incomeId: income.id }, "income-auto-post: JE insert failed (non-fatal)");
  }
}

// ── Income Voided / Deleted ───────────────────────────────────────────────────
// Soft-remove JE(s) from all statements — do NOT post a VOID reverse entry.

export async function reverseIncomeJE(
  incomeId: number,
  companyId: number,
  _description: string,
  _userId: number,
  log?: any,
): Promise<void> {
  const { removeJournalEntriesForRef } = await import("./journal-entry-remove.js");
  await removeJournalEntriesForRef({
    companyId,
    refType: "income_record",
    refId: incomeId,
    log,
  });
}
