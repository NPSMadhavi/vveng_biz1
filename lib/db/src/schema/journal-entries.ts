import { pgTable, text, serial, timestamp, integer, smallint } from "drizzle-orm/pg-core";

export const journalEntriesTable = pgTable("journal_entries", {
  id:           serial("id").primaryKey(),
  companyId:    integer("company_id").notNull(),
  entryDate:    text("entry_date").notNull(),    // YYYY-MM-DD
  description:  text("description").notNull(),
  refType:      text("ref_type"),                // invoice | purchase_order | vendor_payment | invoice_payment | manual
  refId:        integer("ref_id"),               // FK to the source document id
  refNumber:    text("ref_number"),              // human-readable e.g. "INV-0001"
  status:       text("status").notNull().default("posted"), // draft | posted | reversed
  reversalOfId: integer("reversal_of_id"),       // if this is a reversal, points to original entry id
  createdBy:    integer("created_by").notNull(),
  /** Soft delete: 0 = visible in app, 1 = hidden (row kept in DB). */
  isDeleted: smallint("is_deleted").notNull().default(0),

  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JournalEntryRecord = typeof journalEntriesTable.$inferSelect;
