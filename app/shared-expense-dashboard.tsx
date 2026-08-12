"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Transaction = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  industry: string;
  status: string;
  reason: string;
  dailySpend: number;
  nextDayDeposit: number;
  matchedReimbursement: number;
  adjustedAmount: number;
  requiresApproval: boolean;
};

type Analysis = {
  demo?: boolean;
  privacyNotice?: string;
  generatedAt: string;
  rawRows: number;
  duplicateRows: number;
  depositRows?: number;
  duplicateDepositRows?: number;
  summary: {
    canonical_rows: number;
    date_min: string;
    date_max: string;
    confirmed_count: number;
    approval_count: number;
    excluded_monthly_count: number;
    original_spend: number;
  };
  rules: {
    restaurant_review_threshold: number;
    restaurant_confirm_threshold: number;
    cafe_review_threshold: number;
    cafe_confirm_threshold: number;
    delivery_review_threshold: number;
    large_day_threshold: number;
    restaurant_industries: string[];
    restaurant_merchant_keywords: string[];
    delivery_merchant_keywords: string[];
    cafe_industries: string[];
    cafe_merchant_keywords: string[];
    personal_exception_industries: string[];
    personal_exception_keywords: string[];
  };
  transactions: Transaction[];
};

type ExpenseInput = { date: string; merchant: string; amount: number; industry: string };
type DepositInput = { date: string; memo: string; amount: number };
type MonthlyImport = {
  month: string;
  expenses: ExpenseInput[];
  deposits: DepositInput[];
  cardFilename: string;
  bankFilename: string;
  updatedAt: string;
};

type Decision = {
  choice: "shared" | "personal" | "pending";
  reimbursement: number;
};

type Tab = "review" | "confirmed" | "all";

const money = new Intl.NumberFormat("ko-KR");
const STORAGE_KEY = "shared-expense-decisions-v1";

function normalizeDate(value: string) {
  const compact = value.trim().replaceAll(".", "-").replaceAll("/", "-");
  const match = compact.match(/(20\d{2})-?(\d{1,2})-?(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function parseAmount(value: string) {
  return Math.round(Number(value.replace(/[^0-9.-]/g, "")) || 0);
}

function parseDelimited(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const delimiter = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function findColumn(headers: string[], candidates: string[]) {
  const normalized = headers.map((header) => header.replaceAll(" ", "").toLowerCase());
  return normalized.findIndex((header) => candidates.some((candidate) => header === candidate.toLowerCase()));
}

function parseExpenseCsv(text: string, month: string): ExpenseInput[] {
  const rows = parseDelimited(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const dateIndex = findColumn(headers, ["이용일", "매출일", "거래일", "날짜", "거래일자"]);
  const merchantIndex = findColumn(headers, ["가맹점명", "이용가맹점", "가맹점", "거래내용", "적요"]);
  const amountIndex = findColumn(headers, ["이용금액(원)", "이용금액", "매출원금", "출금액", "금액"]);
  const industryIndex = findColumn(headers, ["업종", "카테고리", "분류"]);
  if (dateIndex < 0 || merchantIndex < 0 || amountIndex < 0) return [];
  return rows.slice(1).map((row) => ({
    date: normalizeDate(row[dateIndex] || ""),
    merchant: (row[merchantIndex] || "").trim(),
    amount: parseAmount(row[amountIndex] || ""),
    industry: industryIndex >= 0 ? (row[industryIndex] || "미분류").trim() : "미분류",
  })).filter((item) => item.date.startsWith(month) && item.merchant && item.amount !== 0);
}

function parseDepositCsv(text: string, month: string): DepositInput[] {
  const rows = parseDelimited(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const dateIndex = findColumn(headers, ["거래일", "입금일", "날짜", "거래일자"]);
  const amountIndex = findColumn(headers, ["입금액", "입금금액", "받은금액", "금액"]);
  const memoIndex = findColumn(headers, ["적요", "거래내용", "입금자", "보낸분", "의뢰인", "메모"]);
  if (dateIndex < 0 || amountIndex < 0) return [];
  return rows.slice(1).map((row) => ({
    date: normalizeDate(row[dateIndex] || ""),
    memo: memoIndex >= 0 ? (row[memoIndex] || "").trim() : "입금",
    amount: parseAmount(row[amountIndex] || ""),
  })).filter((item) => item.date >= `${month}-01` && item.amount > 0);
}

function nextDate(value: string) {
  const current = new Date(`${value}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() + 1);
  return current.toISOString().slice(0, 10);
}

function compactText(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function hasKeyword(value: string, keywords: string[]) {
  const normalized = compactText(value);
  return keywords.some((keyword) => normalized.includes(compactText(keyword)));
}

function stableToken(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function classifyImport(monthlyImport: MonthlyImport, rules: Analysis["rules"]): Transaction[] {
  const depositsByDate = new Map<string, number>();
  monthlyImport.deposits.forEach((deposit) => depositsByDate.set(deposit.date, (depositsByDate.get(deposit.date) || 0) + deposit.amount));
  const spendByDate = new Map<string, number>();
  monthlyImport.expenses.forEach((expense) => {
    if (expense.amount > 0) spendByDate.set(expense.date, (spendByDate.get(expense.date) || 0) + expense.amount);
  });
  const occurrence = new Map<string, number>();
  const records = monthlyImport.expenses.map((expense) => {
    const key = `${expense.date}|${expense.merchant}|${expense.amount}`;
    occurrence.set(key, (occurrence.get(key) || 0) + 1);
    const id = `M-${expense.date.replaceAll("-", "")}-${stableToken(`${key}|${occurrence.get(key)}`)}`;
    return { expense, id };
  });
  const largestByDate = new Map<string, string>();
  const eligibleSpendByDate = new Map<string, number>();
  records.forEach(({ expense, id }) => {
    const existingId = largestByDate.get(expense.date);
    const existing = records.find((record) => record.id === existingId)?.expense.amount || -Infinity;
    const delivery = hasKeyword(expense.merchant, rules.delivery_merchant_keywords);
    const excluded = !delivery && (rules.personal_exception_industries.includes(expense.industry)
      || hasKeyword(`${expense.merchant} ${expense.industry}`, rules.personal_exception_keywords));
    if (!excluded && expense.amount > 0) {
      eligibleSpendByDate.set(expense.date, (eligibleSpendByDate.get(expense.date) || 0) + expense.amount);
      if (expense.amount > existing) largestByDate.set(expense.date, id);
    }
  });

  return records.map(({ expense, id }) => {
    const text = `${expense.merchant} ${expense.industry}`;
    const delivery = hasKeyword(expense.merchant, rules.delivery_merchant_keywords);
    const excluded = !delivery && (rules.personal_exception_industries.includes(expense.industry)
      || hasKeyword(text, rules.personal_exception_keywords));
    const restaurant = !delivery && (rules.restaurant_industries.includes(expense.industry) || hasKeyword(expense.merchant, rules.restaurant_merchant_keywords));
    const cafe = rules.cafe_industries.includes(expense.industry) || hasKeyword(expense.merchant, rules.cafe_merchant_keywords);
    const dailySpend = spendByDate.get(expense.date) || 0;
    const signalDailySpend = eligibleSpendByDate.get(expense.date) || 0;
    const deposit = depositsByDate.get(nextDate(expense.date)) || 0;
    const highDay = signalDailySpend >= rules.large_day_threshold && deposit > 0 && deposit < signalDailySpend && largestByDate.get(expense.date) === id;
    let status = "일반지출";
    let reason = "규칙 미해당";
    let requiresApproval = false;
    if (expense.amount < 0) {
      status = "환불/취소";
      reason = "음수 금액 거래";
    } else if (excluded) {
      reason = hasKeyword(expense.merchant, ["고기백화점"])
        ? "고정 개인지출 예외(정육점 장보기)"
        : hasKeyword(expense.merchant, ["밥도시락주식회사"])
          ? "고정 개인지출 예외(월별 학원 급식)"
          : "고정 개인지출 예외(쇼핑·의료·통신·대중교통·교육)";
    } else if (cafe && expense.amount >= rules.cafe_confirm_threshold) {
      status = "공동지출 확정";
      reason = `카페 ${money.format(rules.cafe_confirm_threshold)}원 이상`;
    } else if (cafe && expense.amount >= rules.cafe_review_threshold) {
      status = "승인 필요";
      reason = `카페 ${money.format(rules.cafe_review_threshold)}원 이상`;
      requiresApproval = true;
    } else if (delivery && expense.amount >= rules.delivery_review_threshold) {
      status = "승인 필요";
      reason = `배달 플랫폼 ${money.format(rules.delivery_review_threshold)}원 이상`;
      requiresApproval = true;
    } else if (restaurant && expense.amount >= rules.restaurant_confirm_threshold) {
      status = "공동지출 확정";
      reason = `음식점 ${money.format(rules.restaurant_confirm_threshold)}원 이상`;
    } else if (restaurant && expense.amount >= rules.restaurant_review_threshold) {
      status = "승인 필요";
      reason = `음식점 ${money.format(rules.restaurant_review_threshold)}원 이상`;
      requiresApproval = true;
    } else if (highDay) {
      status = "승인 필요";
      reason = `당일 지출 ${money.format(signalDailySpend)}원, 다음날 입금 ${money.format(deposit)}원`;
      requiresApproval = true;
    }
    const confirmedMatches = status === "공동지출 확정" && deposit > 0 && deposit < expense.amount ? deposit : 0;
    return {
      id,
      date: expense.date,
      merchant: expense.merchant,
      amount: expense.amount,
      industry: expense.industry || "미분류",
      status,
      reason,
      dailySpend,
      nextDayDeposit: deposit,
      matchedReimbursement: confirmedMatches,
      adjustedAmount: status === "공동지출 확정" ? expense.amount - confirmedMatches : expense.amount,
      requiresApproval,
    };
  });
}

function formatMoney(value: number) {
  return `${money.format(Math.round(value))}원`;
}

function statusLabel(transaction: Transaction, decision?: Decision) {
  if (transaction.requiresApproval) {
    if (decision?.choice === "shared") return "공동지출 승인";
    if (decision?.choice === "personal") return "개인지출";
    return "승인 필요";
  }
  return transaction.status;
}

function effectiveAmount(transaction: Transaction, decision?: Decision) {
  const reimbursement = Math.max(transaction.matchedReimbursement, decision?.reimbursement || 0);
  if (transaction.status === "공동지출 확정" || decision?.choice === "shared") {
    return Math.max(0, transaction.amount - reimbursement);
  }
  return transaction.amount;
}

export function SharedExpenseDashboard() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [monthlyImports, setMonthlyImports] = useState<MonthlyImport[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [activeTab, setActiveTab] = useState<Tab>("review");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("전체 상태");
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState("");
  const [inputOpen, setInputOpen] = useState(false);
  const [inputMonth, setInputMonth] = useState(new Date().toISOString().slice(0, 7));
  const [cardCsv, setCardCsv] = useState("");
  const [bankCsv, setBankCsv] = useState("");
  const [cardFilename, setCardFilename] = useState("");
  const [bankFilename, setBankFilename] = useState("");
  const [savingImport, setSavingImport] = useState(false);
  const [inputError, setInputError] = useState("");

  useEffect(() => {
    fetch("/data/transactions.json")
      .then((response) => response.json())
      .then(async (data: Analysis) => {
        setAnalysis(data);
        if (data.demo) {
          setMonthlyImports([]);
          return;
        }
        const response = await fetch("/api/monthly-imports");
        const payload = await response.json();
        setMonthlyImports(Array.isArray(payload.imports) ? payload.imports : []);
      })
      .catch(() => setToast("분석 결과를 불러오지 못했습니다."));
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setDecisions(JSON.parse(saved));
    } catch {
      // Local decisions are optional.
    }
  }, []);

  useEffect(() => {
    if (!Object.keys(decisions).length) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions));
  }, [decisions]);

  const transactions = useMemo(() => {
    if (!analysis) return [];
    const imported = monthlyImports.flatMap((item) => classifyImport(item, analysis.rules));
    const merged = new Map<string, Transaction>();
    [...analysis.transactions, ...imported].forEach((transaction) => {
      const key = `${transaction.date}|${compactText(transaction.merchant)}|${transaction.amount}`;
      if (!merged.has(key) || transaction.id.startsWith("M-")) merged.set(key, transaction);
    });
    return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant));
  }, [analysis, monthlyImports]);
  const approvalTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.requiresApproval),
    [transactions],
  );
  const confirmedTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.status === "공동지출 확정"),
    [transactions],
  );

  const pendingCount = approvalTransactions.filter(
    (transaction) => !decisions[transaction.id] || decisions[transaction.id].choice === "pending",
  ).length;

  const originalSpend = transactions.reduce((total, transaction) => total + Math.max(0, transaction.amount), 0);
  const adjustedSpend = transactions.reduce(
    (total, transaction) => total + Math.max(0, effectiveAmount(transaction, decisions[transaction.id])),
    0,
  );
  const savedAmount = Math.max(0, originalSpend - adjustedSpend);

  const monthly = useMemo(() => {
    const grouped = new Map<string, { spend: number; shared: number; count: number }>();
    transactions.forEach((transaction) => {
      const month = transaction.date.slice(0, 7);
      const current = grouped.get(month) || { spend: 0, shared: 0, count: 0 };
      if (transaction.amount > 0) current.spend += transaction.amount;
      if (transaction.status === "공동지출 확정" || decisions[transaction.id]?.choice === "shared") {
        current.shared += Math.max(0, transaction.amount - effectiveAmount(transaction, decisions[transaction.id]));
      }
      current.count += 1;
      grouped.set(month, current);
    });
    return [...grouped.entries()].slice(-12).map(([month, values]) => ({ month, ...values }));
  }, [transactions, decisions]);

  const maxMonthlySpend = Math.max(...monthly.map((month) => month.spend), 1);

  const baseRows = activeTab === "review"
    ? approvalTransactions
    : activeTab === "confirmed"
      ? confirmedTransactions
      : transactions;

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return baseRows.filter((transaction) => {
      const label = statusLabel(transaction, decisions[transaction.id]);
      const matchesQuery = !needle || `${transaction.merchant} ${transaction.industry} ${transaction.date}`.toLowerCase().includes(needle);
      const matchesStatus = statusFilter === "전체 상태" || label === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [baseRows, decisions, query, statusFilter]);

  const rowsPerPage = activeTab === "all" ? 15 : 20;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / rowsPerPage));
  const visibleRows = filteredRows.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const inputPreview = useMemo(() => ({
    expenses: cardCsv.trim() ? parseExpenseCsv(cardCsv, inputMonth) : [],
    deposits: bankCsv.trim() ? parseDepositCsv(bankCsv, inputMonth) : [],
  }), [cardCsv, bankCsv, inputMonth]);
  const dataStart = transactions[0]?.date || analysis?.summary.date_min || "";
  const dataEnd = transactions[transactions.length - 1]?.date || analysis?.summary.date_max || "";
  const demoMode = Boolean(analysis?.demo);

  function updateDecision(id: string, patch: Partial<Decision>) {
    setDecisions((current) => ({
      ...current,
      [id]: {
        choice: current[id]?.choice || "pending",
        reimbursement: current[id]?.reimbursement || 0,
        ...patch,
      },
    }));
  }

  async function loadCsvFile(file: File, kind: "card" | "bank") {
    const text = await file.text();
    if (kind === "card") {
      setCardCsv(text);
      setCardFilename(file.name);
    } else {
      setBankCsv(text);
      setBankFilename(file.name);
    }
  }

  async function saveMonthlyImport() {
    setInputError("");
    const expenses = parseExpenseCsv(cardCsv, inputMonth);
    const deposits = bankCsv.trim() ? parseDepositCsv(bankCsv, inputMonth) : [];
    if (!expenses.length) {
      setInputError("카드 CSV에서 이용일·가맹점·금액 열을 찾지 못했거나 선택한 월의 거래가 없습니다.");
      return;
    }
    if (bankCsv.trim() && !deposits.length) {
      setInputError("계좌 CSV에서 거래일·입금액 열을 찾지 못했습니다.");
      return;
    }
    setSavingImport(true);
    try {
      const response = await fetch("/api/monthly-imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month: inputMonth, expenses, deposits, cardFilename, bankFilename }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "저장하지 못했습니다.");
      const nextImport: MonthlyImport = {
        month: inputMonth,
        expenses,
        deposits,
        cardFilename,
        bankFilename,
        updatedAt: new Date().toISOString(),
      };
      setMonthlyImports((current) => [nextImport, ...current.filter((item) => item.month !== inputMonth)].sort((a, b) => b.month.localeCompare(a.month)));
      setCardCsv("");
      setBankCsv("");
      setCardFilename("");
      setBankFilename("");
      setInputOpen(false);
      setActiveTab("review");
      setPage(1);
      setToast(`${inputMonth} 데이터 ${expenses.length + deposits.length}건을 반영했습니다.`);
      window.setTimeout(() => setToast(""), 2800);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally {
      setSavingImport(false);
    }
  }

  async function deleteMonthlyImport(month: string) {
    const response = await fetch(`/api/monthly-imports?month=${encodeURIComponent(month)}`, { method: "DELETE" });
    if (!response.ok) {
      setInputError("삭제하지 못했습니다.");
      return;
    }
    setMonthlyImports((current) => current.filter((item) => item.month !== month));
    setToast(`${month} 입력 내역을 삭제했습니다.`);
    window.setTimeout(() => setToast(""), 2400);
  }

  function downloadCsv() {
    const headers = ["이용일", "가맹점", "업종", "원금액", "판정", "정산입금", "소비반영액"];
    const rows = transactions.map((transaction) => {
      const decision = decisions[transaction.id];
      return [
        transaction.date,
        transaction.merchant,
        transaction.industry,
        transaction.amount,
        statusLabel(transaction, decision),
        Math.max(transaction.matchedReimbursement, decision?.reimbursement || 0),
        effectiveAmount(transaction, decision),
      ];
    });
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "공동지출_소비반영.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    setToast("소비 반영 CSV를 저장했습니다.");
    window.setTimeout(() => setToast(""), 2400);
  }

  if (!analysis) {
    return (
      <main className="loading-shell">
        <div className="loading-mark">우</div>
        <p>거래를 정리하고 있어요</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="우리지출 홈">
          <span className="brand-mark">우</span>
          <span>우리지출</span>
        </a>
        <nav aria-label="주요 메뉴">
          <a href="#overview">대시보드</a>
          <a href="#transactions">거래 검토</a>
          <a href="#rules">자동화 규칙</a>
          <Link href="/v2">학습형 Ver.2</Link>
        </nav>
        <div className="topbar-actions">
          <button className="input-button" disabled={demoMode} title={demoMode ? "공개 데모에서는 데이터 입력이 잠겨 있습니다." : undefined} onClick={() => { setInputError(""); setInputOpen(true); }}>
            <span aria-hidden="true">{demoMode ? "◎" : "＋"}</span> {demoMode ? "공개 데모 · 입력 잠금" : "월별 데이터 입력"}
          </button>
          <button className="export-button" onClick={downloadCsv}>
            소비내역 내보내기 <span aria-hidden="true">↓</span>
          </button>
        </div>
      </header>

      {demoMode && (
        <aside className="demo-banner" role="note">
          <strong>PUBLIC DEMO</strong>
          <span>익명화된 대표 거래 15건만 표시합니다. 실제 카드·계좌 내역과 학습 데이터는 포함되지 않았습니다.</span>
          <em>업로드·서버 저장 잠금</em>
        </aside>
      )}

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span className="live-dot" /> 카드·계좌 분석 완료</p>
          <h1>같이 쓴 돈은 빼고,<br /><em>내가 쓴 만큼만.</em></h1>
          <p className="hero-description">
            카드 지출과 정산 입금을 연결해 공동지출을 찾아냈어요.<br />애매한 {pendingCount}건만 확인하면 소비내역이 완성됩니다.
          </p>
        </div>
        <div className="hero-visual" aria-label="공동지출 계산 예시">
          <div className="receipt-card">
            <div className="receipt-head"><span>오늘 저녁</span><b>100,000원</b></div>
            <div className="people-row"><span>나</span><span>친구 1</span><span>친구 2</span><span>친구 3</span></div>
            <div className="split-line"><i style={{ width: "25%" }} /></div>
            <div className="receipt-result"><small>내 실제 지출</small><strong>25,000원</strong></div>
          </div>
          <div className="floating-note note-one">+25,000원<br /><small>정산 입금</small></div>
          <div className="floating-note note-two">자동 반영 ✓</div>
        </div>
      </section>

      <section className="overview" id="overview">
        <div className="section-heading">
          <div><p className="section-kicker">OVERVIEW</p><h2>한눈에 보는 분석 결과</h2></div>
          <p>{dataStart} — {dataEnd}</p>
        </div>

        <div className="stat-grid">
          <article className="stat-card dark">
            <span className="stat-icon">⌁</span>
            <p>정제된 거래</p><strong>{money.format(transactions.length)}<small>건</small></strong>
            <span>카드 {money.format(analysis.duplicateRows)}건 중복 제거</span>
          </article>
          <article className="stat-card coral">
            <span className="stat-icon">!</span>
            <p>승인 필요</p><strong>{pendingCount}<small>건</small></strong>
            <span>카페·식당·배달 및 입금 후보</span>
          </article>
          <article className="stat-card mint">
            <span className="stat-icon">✓</span>
            <p>공동지출 확정</p><strong>{confirmedTransactions.length}<small>건</small></strong>
            <span>카페 2만원·식당 3만원 이상</span>
          </article>
          <article className="stat-card cream">
            <span className="stat-icon">↘</span>
            <p>소비액 감소</p><strong>{formatMoney(savedAmount)}</strong>
            <span>정산 입력에 따라 바로 갱신</span>
          </article>
        </div>

        <div className="insight-grid">
          <article className="chart-card">
            <div className="card-title-row"><div><p className="section-kicker">LAST 12 MONTHS</p><h3>월별 카드 지출</h3></div><span className="legend"><i /> 카드 지출</span></div>
            <div className="bar-chart" aria-label="최근 12개월 카드 지출 막대그래프">
              {monthly.map((item) => (
                <div className="bar-column" key={item.month} title={`${item.month}: ${formatMoney(item.spend)}`}>
                  <span className="bar-value">{Math.round(item.spend / 10000)}만</span>
                  <div className="bar-track"><i style={{ height: `${Math.max(7, (item.spend / maxMonthlySpend) * 100)}%` }} /></div>
                  <span>{item.month.slice(5)}월</span>
                </div>
              ))}
            </div>
          </article>
          <article className="impact-card">
            <p className="section-kicker">REAL SPEND</p>
            <h3>현재 반영 소비액</h3>
            <strong>{formatMoney(adjustedSpend)}</strong>
            <div className="impact-row"><span>카드 원금</span><b>{formatMoney(originalSpend)}</b></div>
            <div className="impact-row accent"><span>정산 반영</span><b>− {formatMoney(savedAmount)}</b></div>
            <div className="progress"><i style={{ width: `${originalSpend ? Math.min(100, (savedAmount / originalSpend) * 100) : 0}%` }} /></div>
            <p className="impact-note">확정 거래에 정산 입금액을 입력하면<br />실질 소비액이 즉시 바뀝니다.</p>
          </article>
        </div>
      </section>

      <section className="review-section" id="transactions">
        <div className="section-heading review-heading">
          <div><p className="section-kicker">REVIEW QUEUE</p><h2>거래 검토</h2></div>
          <div className="queue-pill"><span>{pendingCount}</span>건 남음</div>
        </div>

        <div className="review-panel">
          <div className="tabs" role="tablist" aria-label="거래 목록">
            <button className={activeTab === "review" ? "active" : ""} onClick={() => { setActiveTab("review"); setPage(1); }}>승인 필요 <b>{approvalTransactions.length}</b></button>
            <button className={activeTab === "confirmed" ? "active" : ""} onClick={() => { setActiveTab("confirmed"); setPage(1); }}>공동지출 확정 <b>{confirmedTransactions.length}</b></button>
            <button className={activeTab === "all" ? "active" : ""} onClick={() => { setActiveTab("all"); setPage(1); }}>전체 거래 <b>{transactions.length}</b></button>
          </div>

          <div className="toolbar">
            <label className="search-box"><span>⌕</span><input aria-label="가맹점 또는 업종 검색" placeholder="가맹점 또는 업종 검색" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></label>
            <select aria-label="상태 필터" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
              <option>전체 상태</option>
              <option>승인 필요</option>
              <option>공동지출 확정</option>
              <option>공동지출 승인</option>
              <option>개인지출</option>
              <option>일반지출</option>
            </select>
          </div>

          <div className="transaction-list">
            {visibleRows.length === 0 && <div className="empty-state">조건에 맞는 거래가 없습니다.</div>}
            {visibleRows.map((transaction) => {
              const decision = decisions[transaction.id];
              const label = statusLabel(transaction, decision);
              const reimbursement = decision?.reimbursement || transaction.matchedReimbursement || 0;
              const canReview = transaction.requiresApproval;
              const isShared = transaction.status === "공동지출 확정" || decision?.choice === "shared";
              return (
                <article className={`transaction-row ${canReview ? "needs-review" : ""}`} key={transaction.id}>
                  <div className="date-block"><b>{transaction.date.slice(8)}</b><span>{transaction.date.slice(5, 7)}월</span></div>
                  <div className="merchant-block">
                    <div className="merchant-line"><h3>{transaction.merchant}</h3><span className={`status-chip ${label.replaceAll(" ", "-")}`}>{label}</span></div>
                    <p>{transaction.industry} · {transaction.reason}</p>
                  </div>
                  <div className="amount-block"><strong>{formatMoney(transaction.amount)}</strong><span>당일 총 {formatMoney(transaction.dailySpend)}</span></div>
                  <div className="settlement-block">
                    {(isShared || canReview) && (
                      <label>정산 입금<input aria-label={`${transaction.merchant} 정산 입금액`} inputMode="numeric" value={reimbursement || ""} placeholder="0" onChange={(event) => updateDecision(transaction.id, { reimbursement: Number(event.target.value.replaceAll(",", "")) || 0 })} /><span>원</span></label>
                    )}
                    {isShared && <small>반영액 {formatMoney(effectiveAmount(transaction, decision))}</small>}
                  </div>
                  <div className="action-block">
                    {canReview ? (
                      <div className="decision-buttons" aria-label={`${transaction.merchant} 판정`}>
                        <button className={decision?.choice === "shared" ? "selected shared" : ""} onClick={() => updateDecision(transaction.id, { choice: "shared" })}>공동</button>
                        <button className={decision?.choice === "personal" ? "selected personal" : ""} onClick={() => updateDecision(transaction.id, { choice: "personal" })}>개인</button>
                      </div>
                    ) : <span className="auto-mark">자동 분류</span>}
                  </div>
                </article>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div className="pagination">
              <button disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>이전</button>
              <span>{page} / {pageCount}</span>
              <button disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>다음</button>
            </div>
          )}
        </div>
      </section>

      <section className="rules-section" id="rules">
        <div className="section-heading"><div><p className="section-kicker">AUTOMATION RULES</p><h2>적용 중인 자동화 규칙</h2></div><p>예외가 확정 규칙보다 먼저 적용됩니다.</p></div>
        <div className="rule-grid">
          <article><span>01</span><h3>카페 1.3만 / 2만원</h3><p>1.3만원부터 의심 · 2만원부터 공동 확정</p></article>
          <article><span>02</span><h3>식당 2만 / 3만원</h3><p>2만원부터 의심 · 3만원부터 공동 확정</p></article>
          <article><span>03</span><h3>배달 1.8만원 이상</h3><p>쿠팡이츠·배민·요기요는 승인 요청</p></article>
          <article><span>04</span><h3>큰 지출 다음날 입금</h3><p>당일 지출보다 작은 입금이면 후보</p></article>
          <article className="exception"><span>개인</span><h3>쇼핑 · 의료 · 통신</h3><p>금액과 관계없이 개인지출</p></article>
          <article className="exception"><span>개인</span><h3>티머니 · 교육</h3><p>대중교통과 학원·스터디는 개인지출</p></article>
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark">우</span><span>우리지출</span></div>
        <p>{demoMode ? "공개 포트폴리오 · 익명화 샘플 15건 · 서버 저장 기능 잠금" : `카드 원본 ${money.format(analysis.rawRows)}행 · 계좌 입금 ${money.format(analysis.depositRows || 0)}건 · 중복 ${money.format(analysis.duplicateRows + (analysis.duplicateDepositRows || 0))}행 제거 · 결정은 이 기기에 저장됩니다.`}</p>
      </footer>
      {inputOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInputOpen(false); }}>
          <section className="input-modal" role="dialog" aria-modal="true" aria-labelledby="monthly-input-title">
            <header className="modal-header">
              <div>
                <p className="section-kicker">MONTHLY INPUT</p>
                <h2 id="monthly-input-title">월별 카드·계좌 데이터 입력</h2>
                <p>같은 월을 다시 저장하면 기존 입력을 안전하게 교체합니다.</p>
              </div>
              <button className="modal-close" aria-label="월별 데이터 입력 닫기" onClick={() => setInputOpen(false)}>×</button>
            </header>

            <div className="month-selector">
              <label>반영할 월<input type="month" value={inputMonth} onChange={(event) => setInputMonth(event.target.value)} /></label>
              <div><b>{inputPreview.expenses.length + inputPreview.deposits.length}건</b><span>미리 인식됨</span></div>
            </div>

            <div className="input-columns">
              <article className="data-input-card">
                <div className="input-card-heading"><span>1</span><div><h3>카드 지출</h3><p>필수 · CSV 또는 탭 구분 데이터</p></div></div>
                <label className="file-drop">
                  <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadCsvFile(file, "card"); }} />
                  <b>{cardFilename || "카드 CSV 선택"}</b>
                  <span>이용일 · 가맹점명 · 이용금액 · 업종</span>
                </label>
                <textarea aria-label="카드 지출 CSV 붙여넣기" placeholder={'이용일,가맹점명,이용금액(원),업종\n2026-08-03,동네카페,28000,음료'} value={cardCsv} onChange={(event) => { setCardCsv(event.target.value); if (!event.target.value) setCardFilename(""); }} />
                <div className="recognized"><span className={inputPreview.expenses.length ? "ok" : ""}>✓</span>{inputPreview.expenses.length}건 인식</div>
              </article>

              <article className="data-input-card">
                <div className="input-card-heading"><span>2</span><div><h3>계좌 입금</h3><p>선택 · 정산 입금 자동 연결</p></div></div>
                <label className="file-drop">
                  <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadCsvFile(file, "bank"); }} />
                  <b>{bankFilename || "계좌 CSV 선택"}</b>
                  <span>거래일 · 입금액 · 적요/입금자</span>
                </label>
                <textarea aria-label="계좌 입금 CSV 붙여넣기" placeholder={'거래일,입금액,적요\n2026-08-04,21000,친구 정산'} value={bankCsv} onChange={(event) => { setBankCsv(event.target.value); if (!event.target.value) setBankFilename(""); }} />
                <div className="recognized"><span className={inputPreview.deposits.length ? "ok" : ""}>✓</span>{inputPreview.deposits.length}건 인식</div>
              </article>
            </div>

            <aside className="input-guide">
              <b>자동 처리되는 항목</b>
              <span>날짜·가맹점·금액 중복 제거</span>
              <span>다음날 입금 합계 연결</span>
              <span>음식점·카페·학원 예외 규칙 적용</span>
            </aside>

            {inputError && <p className="input-error" role="alert">{inputError}</p>}

            {monthlyImports.length > 0 && (
              <div className="import-history">
                <h3>저장된 월별 데이터</h3>
                {monthlyImports.map((item) => (
                  <div key={item.month}>
                    <b>{item.month}</b>
                    <span>카드 {item.expenses.length}건 · 입금 {item.deposits.length}건</span>
                    <small>{item.cardFilename || "직접 입력"}</small>
                    <button onClick={() => { if (window.confirm(`${item.month} 입력 내역을 삭제할까요?`)) void deleteMonthlyImport(item.month); }}>삭제</button>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setInputOpen(false)}>취소</button>
              <button className="save-button" disabled={savingImport || !inputPreview.expenses.length} onClick={() => void saveMonthlyImport()}>
                {savingImport ? "반영 중…" : `${inputMonth} 데이터 반영하기`}
              </button>
            </div>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
