import fs from "node:fs/promises";

const sourcePath = process.argv[2] || "../.tmp/classifier_with_bank/분석결과.json";
const outputPath = process.argv[3] || ".private/transactions.json";
const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const compact = {
  generatedAt: new Date().toISOString(),
  rawRows: source.raw_card_rows,
  duplicateRows: source.duplicate_cards_removed,
  depositRows: source.deposits?.length || 0,
  duplicateDepositRows: source.duplicate_deposits_removed || 0,
  summary: source.summary,
  rules: source.rules,
  deposits: (source.deposits || [])
    .filter((item) => item.candidate)
    .map((item) => ({
      date: item.date,
      amount: item.amount,
      memo: item.memo || "입금",
    })),
  transactions: source.transactions.map((item) => ({
    id: item.transaction_id,
    date: item.date,
    merchant: item.merchant,
    amount: item.amount,
    industry: item.industry || "미분류",
    status: item.status,
    reason: item.reason,
    dailySpend: item.daily_spend,
    nextDayDeposit: item.next_day_deposit,
    matchedReimbursement: item.matched_reimbursement,
    adjustedAmount: item.adjusted_amount,
    requiresApproval: item.requires_approval,
  })),
};

await fs.mkdir(new URL("../.private/", import.meta.url), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(compact));
console.log(`${compact.transactions.length} private transactions prepared at ${outputPath}`);
