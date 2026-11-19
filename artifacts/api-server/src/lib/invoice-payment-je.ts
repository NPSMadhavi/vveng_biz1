/**
 * invoice-payment-je.ts
 *
 * Journal entries for AR (customer invoice) payment recording.
 *
 * ON PAYMENT RECEIVED:
 *   DR 1010 Cash at Bank - SGD   = paymentAmount → cash received
 *   CR 1100 Accounts Receivable  = paymentAmount → AR settled
 *
 * ON PAYMENT DELETED → reverse the payment JE
 *
 * Only posts for Singapore companies (same rule as invoice-auto-post).
 */

import { db, accountsTable, journalEntriesTable, journalLinesTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ensureAccountsSeeded } from "./accounts-seed.js";
import { isSingaporeCountry } from "./singapore.js";
import { assertPeriodWritable } from "./financial-year.js";

async function isSingapore(companyId: number): Promise<boolean> {
  const [co] = await db.select({ country: companiesTable.country })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  return isSingaporeCountry(co?.country);
}

async function getAccountByCode(companyId: number, code: string) {
  const [acct] = await db.select()
    .from(accountsTable)
    .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.code, code)))
    .limit(1);
  return acct ?? null;
}

export async function postARPaymentJE(
  payment: {
    id: number;
    invoiceId: number;
    companyId: number;
    paymentDate: string;
    amount: number | string;
    reference?: string | null;
  },
  invNumber: string,
  customerName: string,
  userId: number,
  log?: any,
): Promise<void> {
  if (!(await isSingapore(payment.companyId))) return;

  await ensureAccountsSeeded(payment.companyId);

  const periodCheck = await assertPeriodWritable(payment.companyId, payment.paymentDate);
  if (!periodCheck.ok) throw new Error(periodCheck.error);

  const [existing] = await db.select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.companyId, payment.companyId),
      eq(journalEntriesTable.refType, "invoice_payment"),
      eq(journalEntriesTable.refId, payment.id),
    ))
    .limit(1);
  if (existing) return;

  const [bankAcct, arAcct] = await Promise.all([
    getAccountByCode(payment.companyId, "1010"),
    getAccountByCode(payment.companyId, "1100"),
  ]);
  if (!bankAcct || !arAcct) {
    if (log) log.warn({ companyId: payment.companyId }, "invoice-payment-je: bank (1010) or AR (1100) account not found");
    return;
  }

  const amount = parseFloat(String(payment.amount)).toFixed(2);
  const ref    = payment.reference ? ` (Ref: ${payment.reference})` : "";
  const desc   = `Payment received — Invoice ${invNumber} — ${customerName}${ref}`;

  try {
    const [entry] = await db.insert(journalEntriesTable).values({
      companyId:   payment.companyId,
      entryDate:   payment.paymentDate,
      description: desc,
      refType:     "invoice_payment",
      refId:       payment.id,
      refNumber:   invNumber,
      status:      "posted",
      createdBy:   userId,
    }).returning();

    await db.insert(journalLinesTable).values([
      { journalEntryId: entry.id, accountId: bankAcct.id, description: desc, debit: amount,  credit: "0.00" },
      { journalEntryId: entry.id, accountId: arAcct.id,   description: desc, debit: "0.00", credit: amount  },
    ]);
  } catch (err) {
    if (log) log.error({ err, invNumber }, "invoice-payment-je: JE insert failed (non-fatal)");
  }
}

export async function reverseARPaymentJE(
  paymentId: number,
  companyId: number,
  _invNumber: string,
  _customerName: string,
  _userId: number,
  log?: any,
): Promise<void> {
  const { removeJournalEntriesForRef } = await import("./journal-entry-remove.js");
  await removeJournalEntriesForRef({
    companyId,
    refType: "invoice_payment",
    refId: paymentId,
    log,
  });
}
