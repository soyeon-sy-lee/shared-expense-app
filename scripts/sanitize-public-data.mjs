import fs from "node:fs/promises";

const privatePath = ".private/transactions.json";
const publicPath = "public/data/transactions.json";

async function exists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(privatePath))) {
  if (!(await exists(publicPath))) throw new Error("원본 거래 파일을 찾을 수 없습니다.");
  await fs.mkdir(".private", { recursive: true });
  await fs.copyFile(publicPath, privatePath);
}

const source = JSON.parse(await fs.readFile(privatePath, "utf8"));

function pickFive(rows) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
  if (sorted.length <= 5) return sorted;
  return [0, 1, 2, 3, 4].map((index) => sorted[Math.round(index * (sorted.length - 1) / 4)]);
}

const shared = pickFive(source.transactions.filter((item) => item.status === "공동지출 확정"));
const review = pickFive(source.transactions.filter((item) => item.requiresApproval));
const personal = pickFive(source.transactions.filter((item) => item.status === "일반지출"));

if (shared.length !== 5 || review.length !== 5 || personal.length !== 5) {
  throw new Error("공동지출·승인필요·개인지출 대표 거래가 각각 5건 이상 필요합니다.");
}

const transactions = [...shared, ...review, ...personal]
  .sort((a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant));

function nextDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const deposits = transactions
  .filter((item) => item.nextDayDeposit > 0)
  .map((item) => ({ date: nextDate(item.date), amount: item.nextDayDeposit, memo: "예시 정산 입금" }));
const originalSpend = transactions.reduce((sum, item) => sum + Math.max(0, item.amount), 0);

const demo = {
  generatedAt: new Date().toISOString(),
  demo: true,
  privacyNotice: "GitHub 공개용 대표 거래 데이터: 공동지출·승인필요·개인지출 각 5건",
  rawRows: transactions.length,
  duplicateRows: 0,
  depositRows: deposits.length,
  duplicateDepositRows: 0,
  summary: {
    canonical_rows: transactions.length,
    date_min: transactions[0]?.date || "",
    date_max: transactions.at(-1)?.date || "",
    confirmed_count: shared.length,
    approval_count: review.length,
    excluded_monthly_count: transactions.filter((item) => item.reason?.includes("월별 결제 예외")).length,
    original_spend: originalSpend,
    adjusted_spend: transactions.reduce((sum, item) => sum + Math.max(0, item.adjustedAmount), 0),
    matched_reimbursement: transactions.reduce((sum, item) => sum + Math.max(0, item.matchedReimbursement), 0),
  },
  rules: source.rules,
  deposits,
  transactions,
};

await fs.mkdir("public/data", { recursive: true });
await fs.writeFile(publicPath, `${JSON.stringify(demo, null, 2)}\n`);
console.log(`공개용 대표 거래 ${transactions.length}건을 생성했습니다.`);
