import { pgTable, serial, text, boolean, timestamp, integer, smallint } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const vendorsTable = pgTable("vendors", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
  postalCode: text("postal_code"),
  country: text("country"),
  contactPerson: text("contact_person"),
  contactEmail: text("contact_email"),
  phone: text("phone"),
  currency: text("currency"),
  gstRegistered: boolean("gst_registered").notNull().default(false),
  gstNo: text("gst_no"),
  usageType: text("usage_type").notNull().default("general"),
  isActive: boolean("is_active").notNull().default(true),
  /** Soft delete: 0 = visible in app, 1 = hidden (row kept in DB). */
  isDeleted: smallint("is_deleted").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VendorRecord = typeof vendorsTable.$inferSelect;
