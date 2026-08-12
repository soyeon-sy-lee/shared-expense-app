import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const monthlyImports = sqliteTable(
  "monthly_imports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    month: text("month").notNull(),
    expensesJson: text("expenses_json").notNull().default("[]"),
    depositsJson: text("deposits_json").notNull().default("[]"),
    cardFilename: text("card_filename").notNull().default(""),
    bankFilename: text("bank_filename").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("monthly_imports_month_unique").on(table.month)],
);

export const trainingLabels = sqliteTable(
  "training_labels",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: text("transaction_id").notNull(),
    label: text("label", { enum: ["shared", "personal"] }).notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("training_labels_transaction_unique").on(table.transactionId)],
);
