import { env } from "cloudflare:workers";

type ExpenseInput = {
  date: string;
  merchant: string;
  amount: number;
  industry?: string;
};

type DepositInput = {
  date: string;
  memo?: string;
  amount: number;
};

async function ensureTable() {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS monthly_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL UNIQUE,
      expenses_json TEXT NOT NULL DEFAULT '[]',
      deposits_json TEXT NOT NULL DEFAULT '[]',
      card_filename TEXT NOT NULL DEFAULT '',
      bank_filename TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS monthly_imports_month_unique ON monthly_imports(month)",
  ).run();
}

function parseRows<T>(value: unknown): T[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET() {
  await ensureTable();
  const result = await env.DB.prepare(
    "SELECT month, expenses_json, deposits_json, card_filename, bank_filename, updated_at FROM monthly_imports ORDER BY month DESC",
  ).all();
  const imports = result.results.map((row) => ({
    month: String(row.month),
    expenses: parseRows<ExpenseInput>(row.expenses_json),
    deposits: parseRows<DepositInput>(row.deposits_json),
    cardFilename: String(row.card_filename || ""),
    bankFilename: String(row.bank_filename || ""),
    updatedAt: String(row.updated_at || ""),
  }));
  return Response.json({ imports });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    month?: string;
    expenses?: ExpenseInput[];
    deposits?: DepositInput[];
    cardFilename?: string;
    bankFilename?: string;
  };
  const month = payload.month?.trim() || "";
  const expenses = Array.isArray(payload.expenses) ? payload.expenses : [];
  const deposits = Array.isArray(payload.deposits) ? payload.deposits : [];

  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    return Response.json({ error: "올바른 연월을 선택해 주세요." }, { status: 400 });
  }
  if (!expenses.length) {
    return Response.json({ error: "카드 지출 데이터가 비어 있습니다." }, { status: 400 });
  }
  if (expenses.length > 5000 || deposits.length > 5000) {
    return Response.json({ error: "한 번에 5,000건까지만 저장할 수 있습니다." }, { status: 400 });
  }

  await ensureTable();
  await env.DB.prepare(`
    INSERT INTO monthly_imports (month, expenses_json, deposits_json, card_filename, bank_filename)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(month) DO UPDATE SET
      expenses_json = excluded.expenses_json,
      deposits_json = excluded.deposits_json,
      card_filename = excluded.card_filename,
      bank_filename = excluded.bank_filename,
      updated_at = CURRENT_TIMESTAMP
  `)
    .bind(
      month,
      JSON.stringify(expenses),
      JSON.stringify(deposits),
      String(payload.cardFilename || ""),
      String(payload.bankFilename || ""),
    )
    .run();
  return Response.json({ ok: true, month });
}

export async function DELETE(request: Request) {
  const month = new URL(request.url).searchParams.get("month") || "";
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    return Response.json({ error: "올바른 연월이 아닙니다." }, { status: 400 });
  }
  await ensureTable();
  await env.DB.prepare("DELETE FROM monthly_imports WHERE month = ?").bind(month).run();
  return Response.json({ ok: true });
}
