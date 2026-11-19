import { pgTable, serial, text, integer, timestamp, smallint } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const emailContactsTable = pgTable("email_contacts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  name: text("name"),
  email: text("email").notNull(),
  useCount: integer("use_count").notNull().default(1),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  /** Soft delete: 0 = visible in app, 1 = hidden (row kept in DB). */
  isDeleted: smallint("is_deleted").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmailContactRecord = typeof emailContactsTable.$inferSelect;
