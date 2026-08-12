import fs from "node:fs/promises";

const data = JSON.parse(await fs.readFile("public/data/transactions.json", "utf8"));
const groups = {
  shared: data.transactions.filter((item) => item.status === "공동지출 확정").length,
  review: data.transactions.filter((item) => item.requiresApproval).length,
  personal: data.transactions.filter((item) => item.status === "일반지출").length,
};

if (!data.demo || data.transactions.length !== 15 || Object.values(groups).some((count) => count !== 5)) {
  throw new Error("공개 데이터에는 공동지출·승인필요·개인지출이 각각 5건만 있어야 합니다.");
}
if (data.deposits.some((item) => item.memo !== "예시 정산 입금")) {
  throw new Error("공개 입금 데이터에 개인 식별 가능 적요가 포함되어 있습니다.");
}
console.log("공개 데이터 개인정보 가드 통과: 거래 15건, 입금자 적요 익명화");
