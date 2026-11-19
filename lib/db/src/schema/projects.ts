import { pgTable, text, serial, timestamp, integer, decimal, smallint } from "drizzle-orm/pg-core";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  status: text("status").notNull().default("active"),
  budget: decimal("budget", { precision: 15, scale: 2 }),
  startDate: text("start_date"),
  endDate: text("end_date"),
  createdBy: integer("created_by").notNull(),
  /** Soft delete: 0 = visible in app, 1 = hidden (row kept in DB). */
  isDeleted: smallint("is_deleted").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectRecord = typeof projectsTable.$inferSelect;
