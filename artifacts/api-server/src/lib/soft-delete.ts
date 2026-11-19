/**
 * Soft delete: rows stay in the database.
 * - App delete  → is_deleted = 1 (hidden in lists / get-by-id)
 * - App lists   → only is_deleted = 0
 * - Manual SQL  → SET is_deleted = 0 brings the row back in the app
 *
 * Column is named is_deleted (0/1). "delete" is a SQL reserved word.
 * ensureSoftDeleteColumns() adds the column to EVERY public base table.
 */
import { sql } from "drizzle-orm";
import type { PgTable, TableConfig } from "drizzle-orm/pg-core";

/** Well-known business tables (kept for docs / typing). All public tables still get the column. */
export const SOFT_DELETE_TABLES = [
  "customers",
  "vendors",
  "employees",
  "users",
  "stock_items",
  "invoices",
  "quotations",
  "sales_orders",
  "purchase_orders",
  "purchase_quotations",
  "vendor_invoices",
  "delivery_orders",
  "grn",
  "proforma_invoices",
  "credit_notes",
  "debit_notes",
  "expenses",
  "income_records",
  "journal_entries",
  "projects",
  "warehouses",
  "sales_persons",
  "assets",
  "licenses",
  "email_contacts",
] as const;

export type SoftDeleteTable = (typeof SOFT_DELETE_TABLES)[number] | string;

type Queryable = { query: (text: string, params?: unknown[]) => Promise<unknown> };

/** Tables we never soft-delete-flag (infra / ephemeral). */
const SKIP_TABLES = new Set([
  "session", // express-session
  "spatial_ref_sys",
]);

/**
 * Idempotent: ADD is_deleted smallint NOT NULL DEFAULT 0
 * on every public base table in this database (except SKIP_TABLES).
 */
export async function ensureSoftDeleteColumns(db: Queryable): Promise<number> {
  let applied = 0;
  try {
    const listed = (await db.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    )) as { rows?: Array<{ table_name: string }> };

    for (const row of listed.rows || []) {
      const table = String(row.table_name || "");
      if (!table || SKIP_TABLES.has(table)) continue;
      if (!/^[a-z_][a-z0-9_]*$/i.test(table)) continue;
      try {
        await db.query(
          `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS is_deleted smallint NOT NULL DEFAULT 0`,
        );
        // Backfill any unexpected NULLs to 0
        await db.query(
          `UPDATE "${table}" SET is_deleted = 0 WHERE is_deleted IS NULL`,
        ).catch(() => undefined);
        applied += 1;
      } catch {
        // Skip tables we cannot alter (permissions / locked).
      }
    }
  } catch {
    // information_schema unavailable — fall back to known list
    for (const table of SOFT_DELETE_TABLES) {
      try {
        await db.query(
          `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS is_deleted smallint NOT NULL DEFAULT 0`,
        );
        applied += 1;
      } catch {
        /* skip */
      }
    }
  }
  return applied;
}

/** SQL fragment: only live rows (safe if column missing via COALESCE). */
export const NOT_DELETED_SQL = sql`COALESCE(is_deleted, 0) = 0`;

/** Drizzle helper when the table has an isDeleted column. */
export function notDeleted<T extends PgTable<TableConfig>>(table: T & { isDeleted: any }) {
  return sql`COALESCE(${table.isDeleted}, 0) = 0`;
}

/**
 * Soft-delete one row by id (+ optional company_id).
 * Returns true if a row was updated.
 */
export async function softDeleteById(
  db: Queryable,
  table: SoftDeleteTable | string,
  opts: { id: number | string; companyId?: number },
): Promise<boolean> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(table))) {
    throw new Error("Invalid soft-delete table name");
  }
  await ensureSoftDeleteColumns(db);
  if (opts.companyId != null) {
    const result = (await db.query(
      `UPDATE "${table}"
       SET is_deleted = 1
       WHERE id = $1 AND company_id = $2 AND COALESCE(is_deleted, 0) = 0
       RETURNING id`,
      [opts.id, opts.companyId],
    )) as { rowCount?: number; rows?: unknown[] };
    return (result.rowCount ?? result.rows?.length ?? 0) > 0;
  }
  const result = (await db.query(
    `UPDATE "${table}"
     SET is_deleted = 1
     WHERE id = $1 AND COALESCE(is_deleted, 0) = 0
     RETURNING id`,
    [opts.id],
  )) as { rowCount?: number; rows?: unknown[] };
  return (result.rowCount ?? result.rows?.length ?? 0) > 0;
}

/** Restore a soft-deleted row (same as setting is_deleted = 0 in SQL). */
export async function restoreSoftDeletedById(
  db: Queryable,
  table: SoftDeleteTable | string,
  opts: { id: number | string; companyId?: number },
): Promise<boolean> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(table))) {
    throw new Error("Invalid soft-delete table name");
  }
  if (opts.companyId != null) {
    const result = (await db.query(
      `UPDATE "${table}"
       SET is_deleted = 0
       WHERE id = $1 AND company_id = $2 AND COALESCE(is_deleted, 0) = 1
       RETURNING id`,
      [opts.id, opts.companyId],
    )) as { rowCount?: number; rows?: unknown[] };
    return (result.rowCount ?? result.rows?.length ?? 0) > 0;
  }
  const result = (await db.query(
    `UPDATE "${table}"
     SET is_deleted = 0
     WHERE id = $1 AND COALESCE(is_deleted, 0) = 1
     RETURNING id`,
    [opts.id],
  )) as { rowCount?: number; rows?: unknown[] };
  return (result.rowCount ?? result.rows?.length ?? 0) > 0;
}
