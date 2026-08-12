import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);

test("publishes only the anonymized 15-transaction demo dataset", async () => {
  const data = JSON.parse(
    await readFile(projectFile("public/data/transactions.json"), "utf8"),
  );

  assert.equal(data.demo, true);
  assert.equal(data.transactions.length, 15);
  assert.deepEqual(
    data.transactions.reduce((counts, transaction) => {
      counts[transaction.status] = (counts[transaction.status] ?? 0) + 1;
      return counts;
    }, {}),
    { "일반지출": 5, "승인필요": 5, "공동지출 확정": 5 },
  );
  assert.ok(data.deposits.every((deposit) => deposit.memo === "예시 정산 입금"));
});

test("keeps the V1 and V2 application routes wired to their dashboards", async () => {
  const [home, v2, layout, v1Dashboard, v2Dashboard, monthlyApi, trainingApi] = await Promise.all([
    readFile(projectFile("app/page.tsx"), "utf8"),
    readFile(projectFile("app/v2/page.tsx"), "utf8"),
    readFile(projectFile("app/layout.tsx"), "utf8"),
    readFile(projectFile("app/shared-expense-dashboard.tsx"), "utf8"),
    readFile(projectFile("app/v2/learning-dashboard.tsx"), "utf8"),
    readFile(projectFile("app/api/monthly-imports/route.ts"), "utf8"),
    readFile(projectFile("app/api/v2-training/route.ts"), "utf8"),
  ]);

  assert.match(home, /SharedExpenseDashboard/);
  assert.match(v2, /LearningDashboard/);
  assert.match(layout, /우리지출/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview|Starter Project/);
  assert.match(v1Dashboard, /PUBLIC DEMO/);
  assert.match(v1Dashboard, /disabled=\{demoMode\}/);
  assert.match(v2Dashboard, /서버에는 저장되지 않습니다/);
  assert.match(monthlyApi, /isPublicDemoRequest/);
  assert.match(trainingApi, /publicDemoWriteResponse/);
});
