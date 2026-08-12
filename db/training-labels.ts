import { env } from "cloudflare:workers";

export type TrainingLabel = {
  transactionId: string;
  label: "shared" | "personal";
  updatedAt: string;
};

export async function ensureTrainingLabelsTable() {
  const db = env.DB;
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS training_labels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL CHECK (label IN ('shared', 'personal')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS training_labels_transaction_unique ON training_labels(transaction_id)",
    ),
  ]);
}

export async function listTrainingLabels(): Promise<TrainingLabel[]> {
  await ensureTrainingLabelsTable();
  const result = await env.DB.prepare(
    "SELECT transaction_id, label, updated_at FROM training_labels ORDER BY updated_at DESC, id DESC",
  ).all();
  return result.results.map((row: Record<string, unknown>) => ({
    transactionId: String(row.transaction_id),
    label: String(row.label) as TrainingLabel["label"],
    updatedAt: String(row.updated_at),
  }));
}

export async function saveTrainingLabel(transactionId: string, label: TrainingLabel["label"]) {
  await ensureTrainingLabelsTable();
  await env.DB.prepare(`
    INSERT INTO training_labels (transaction_id, label)
    VALUES (?, ?)
    ON CONFLICT(transaction_id) DO UPDATE SET
      label = excluded.label,
      updated_at = CURRENT_TIMESTAMP
  `).bind(transactionId, label).run();
}

export async function deleteTrainingLabel(transactionId: string) {
  await ensureTrainingLabelsTable();
  await env.DB.prepare("DELETE FROM training_labels WHERE transaction_id = ?").bind(transactionId).run();
}
