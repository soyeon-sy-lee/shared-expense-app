"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLink, publicPath } from "../app-link";
import { DecisionTreeLab } from "./decision-tree-lab";

type Transaction = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  industry: string;
  dailySpend: number;
  nextDayDeposit: number;
  status?: string;
  requiresApproval?: boolean;
};

type Deposit = { date: string; amount: number; memo: string };
type Analysis = { transactions: Transaction[]; deposits: Deposit[]; demo: boolean };
type LabelValue = "shared" | "personal";
type LabelRecord = { transactionId: string; label: LabelValue; updatedAt: string };
type PredictionFilter = "all" | "shared" | "review" | "personal";
type WorkspaceTab = "learning" | "tree";

const money = new Intl.NumberFormat("ko-KR");
const FEATURE_COUNT = 112;
const MIN_TRAINING_LABELS = 20;
const DINING_INDUSTRIES = [
  "한식", "중식", "일식", "양식", "간이음식점", "패스트푸드점", "일반음식점", "일반주점",
  "음료", "브랜드커피전문점", "제과점,아이스크림점",
];
const DINING_MERCHANT_KEYWORDS = [
  "카페", "커피", "스타벅스", "투썸", "메가MGC", "컴포즈", "이디야", "빽다방", "폴바셋",
  "식당", "식탁", "키친", "다이닝", "국밥", "고기", "치킨", "피자", "버거", "스시", "초밥",
  "배달의민족", "배민", "쿠팡이츠", "요기요",
];
const MEDICAL_KEYWORDS = [
  "약국", "병원", "의원", "내과", "외과", "치과", "안과", "이비인후과", "피부과", "한의", "의료",
  "건강검진", "약품", "정형외과", "산부인과",
];
const TELECOM_KEYWORDS = ["통신비", "통신요금", "휴대폰", "LGU+", "SKT", "KT통신", "케이티통신"];
const SHOPPING_INDUSTRY_KEYWORDS = [
  "인터넷쇼핑", "백화점", "대형마트", "마트", "화장품", "의류", "생활용품", "잡화", "문구용품",
  "서적", "가공식품", "축산물", "인테리어자재",
];
const SHOPPING_MERCHANT_KEYWORDS = [
  "쿠팡", "지마켓", "SSG.COM", "올리브영", "오늘의집", "다이소", "무신사", "지그재그", "영풍문고",
  "교보문고", "알라딘", "마켓컬리", "29CM",
];

function formatMoney(value: number) {
  return `${money.format(Math.round(value))}원`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isDiningTransaction(transaction: Transaction) {
  const industry = transaction.industry.replace(/\s+/g, "").toLowerCase();
  const merchant = transaction.merchant.replace(/\s+/g, "").toLowerCase();
  return DINING_INDUSTRIES.some((value) => industry.includes(value.toLowerCase()))
    || DINING_MERCHANT_KEYWORDS.some((value) => merchant.includes(value.replace(/\s+/g, "").toLowerCase()));
}

function hasTransactionKeyword(transaction: Transaction, keywords: string[]) {
  const text = `${transaction.industry} ${transaction.merchant}`.replace(/\s+/g, "").toLowerCase();
  return keywords.some((value) => text.includes(value.replace(/\s+/g, "").toLowerCase()));
}

function isMedicalTransaction(transaction: Transaction) {
  return hasTransactionKeyword(transaction, MEDICAL_KEYWORDS);
}

function isTelecomTransaction(transaction: Transaction) {
  return hasTransactionKeyword(transaction, TELECOM_KEYWORDS)
    || transaction.industry.replace(/\s+/g, "").includes("통신");
}

function isShoppingTransaction(transaction: Transaction) {
  const industry = transaction.industry.replace(/\s+/g, "").toLowerCase();
  const merchant = transaction.merchant.replace(/\s+/g, "").toLowerCase();
  return SHOPPING_INDUSTRY_KEYWORDS.some((value) => industry.includes(value.replace(/\s+/g, "").toLowerCase()))
    || SHOPPING_MERCHANT_KEYWORDS.some((value) => merchant.includes(value.replace(/\s+/g, "").toLowerCase()));
}

function normalizedLog(value: number) {
  return Math.min(1.5, Math.log1p(Math.max(0, value)) / Math.log(1_000_001));
}

function addHashedTextFeatures(features: number[], text: string, offset: number, width: number) {
  const compact = text.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
  if (!compact) return;
  const grams = [compact];
  for (const size of [2, 3]) {
    for (let index = 0; index <= compact.length - size; index += 1) {
      grams.push(compact.slice(index, index + size));
    }
  }
  const scale = 1 / Math.sqrt(grams.length);
  grams.forEach((gram) => {
    features[offset + stableHash(gram) % width] += scale;
  });
}

function featureVector(transaction: Transaction) {
  const features = new Array<number>(FEATURE_COUNT).fill(0);
  const amount = Math.max(1, transaction.amount);
  const deposit = Math.max(0, transaction.nextDayDeposit);
  const parsedDate = new Date(`${transaction.date}T00:00:00Z`);
  const weekday = parsedDate.getUTCDay();
  const month = parsedDate.getUTCMonth();

  features[0] = 1;
  features[1] = normalizedLog(amount);
  features[2] = normalizedLog(deposit);
  features[3] = deposit > 0 ? 1 : 0;
  features[4] = Math.min(2, deposit / amount) / 2;
  features[5] = deposit ? Math.min(1, Math.abs(amount - deposit) / amount) : 1;
  features[6] = isDiningTransaction(transaction) ? 1 : 0;
  features[7] = isMedicalTransaction(transaction) ? 1 : 0;
  features[8] = isTelecomTransaction(transaction) ? 1 : 0;
  features[9] = isShoppingTransaction(transaction) ? 1 : 0;
  features[10] = features[7] * features[1];
  features[11] = features[8] * features[1];
  features[12] = features[9] * features[1];
  features[13] = Math.sin((weekday / 7) * Math.PI * 2);
  features[14] = Math.cos((weekday / 7) * Math.PI * 2);
  features[15] = Math.sin((month / 12) * Math.PI * 2);
  features[16] = Math.cos((month / 12) * Math.PI * 2);

  const amountBucket = Math.min(7, Math.floor(Math.log10(amount) * 2) - 4);
  features[17 + Math.max(0, amountBucket)] = 1;
  addHashedTextFeatures(features, transaction.merchant, 25, 55);
  addHashedTextFeatures(features, transaction.industry, 80, 32);
  return features;
}

function sigmoid(value: number) {
  const clipped = Math.max(-18, Math.min(18, value));
  return 1 / (1 + Math.exp(-clipped));
}

function fitModel(examples: Array<{ transaction: Transaction; label: LabelValue }>) {
  if (examples.length < 2) return null;
  const positives = examples.filter((example) => example.label === "shared").length;
  const negatives = examples.length - positives;
  if (!positives || !negatives) return null;

  const weights = new Array<number>(FEATURE_COUNT).fill(0);
  const ordered = [...examples].sort((a, b) => a.transaction.id.localeCompare(b.transaction.id));

  for (let epoch = 0; epoch < 240; epoch += 1) {
    const learningRate = 0.22 / (1 + epoch * 0.012);
    for (const example of ordered) {
      const features = featureVector(example.transaction);
      const probability = sigmoid(weights.reduce((sum, weight, index) => sum + weight * features[index], 0));
      const expected = example.label === "shared" ? 1 : 0;
      // 실제 라벨 비율을 그대로 학습해야 출력값을 확률로 해석할 수 있다.
      // 양쪽 클래스 수를 50:50으로 강제하면 소수인 공동지출 확률이 과대평가된다.
      const error = probability - expected;
      for (let index = 0; index < weights.length; index += 1) {
        const regularization = index === 0 ? 0 : 0.004 * weights[index];
        weights[index] -= learningRate * (error * features[index] + regularization);
      }
    }
  }
  return weights;
}

function predict(weights: number[] | null, transaction: Transaction) {
  if (!weights) return 0.5;
  const features = featureVector(transaction);
  return sigmoid(weights.reduce((sum, weight, index) => sum + weight * features[index], 0));
}

function nextDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function modelStage(labelCount: number) {
  if (labelCount < 10) return { name: "정답 수집 중", note: "양쪽 사례가 모이면 첫 모델이 만들어져요." };
  if (labelCount < 30) return { name: "초기 학습", note: "20건부터 모델의 예측과 불확실도를 계산해요." };
  if (labelCount < 100) return { name: "패턴 학습 중", note: "헷갈리는 사례를 우선 질문하고 있어요." };
  return { name: "자동 분류 활성", note: "새 거래마다 학습된 확률을 계산합니다." };
}

export function LearningDashboard() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [labels, setLabels] = useState<Record<string, LabelValue>>({});
  const [history, setHistory] = useState<LabelRecord[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [predictionFilter, setPredictionFilter] = useState<PredictionFilter>("all");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("learning");
  const demoMode = Boolean(analysis?.demo);

  useEffect(() => {
    fetch(publicPath("/data/transactions.json"))
      .then((response) => response.json())
      .then(async (data) => {
        const transactions = Array.isArray(data.transactions) ? data.transactions as Transaction[] : [];
        setAnalysis({ transactions, deposits: data.deposits || [], demo: Boolean(data.demo) });
        if (data.demo) {
          const records: LabelRecord[] = transactions
            .filter((transaction) => transaction.status === "공동지출 확정" || transaction.status === "일반지출")
            .map((transaction) => ({
              transactionId: transaction.id,
              label: transaction.status === "공동지출 확정" ? "shared" : "personal",
              updatedAt: "demo",
            }));
          setHistory(records);
          setLabels(Object.fromEntries(records.map((record) => [record.transactionId, record.label])));
          return;
        }
        const response = await fetch("/api/v2-training");
        const saved = await response.json();
        const records = Array.isArray(saved.labels) ? saved.labels as LabelRecord[] : [];
        setHistory(records);
        setLabels(Object.fromEntries(records.map((record) => [record.transactionId, record.label])));
      })
      .catch(() => setNotice("학습 데이터를 불러오지 못했습니다."));
  }, []);

  const expenses = useMemo(
    () => (analysis?.transactions || []).filter((transaction) => transaction.amount > 0),
    [analysis],
  );
  const transactionById = useMemo(
    () => new Map(expenses.map((transaction) => [transaction.id, transaction])),
    [expenses],
  );
  const examples = useMemo(
    () => Object.entries(labels)
      .map(([id, label]) => ({ transaction: transactionById.get(id), label }))
      .filter((example): example is { transaction: Transaction; label: LabelValue } => Boolean(example.transaction)),
    [labels, transactionById],
  );
  const weights = useMemo(() => fitModel(examples), [examples]);
  const predictions = useMemo(
    () => expenses.map((transaction) => ({ transaction, probability: predict(weights, transaction) })),
    [expenses, weights],
  );
  const predictionById = useMemo(
    () => new Map(predictions.map((item) => [item.transaction.id, item.probability])),
    [predictions],
  );

  const validationAccuracy = useMemo(() => {
    if (examples.length < 30) return null;
    const validation = examples.filter((example) => stableHash(example.transaction.id) % 5 === 0);
    const training = examples.filter((example) => stableHash(example.transaction.id) % 5 !== 0);
    const validationWeights = fitModel(training);
    if (!validationWeights || validation.length < 4) return null;
    const correct = validation.filter((example) =>
      (predict(validationWeights, example.transaction) >= 0.5) === (example.label === "shared"),
    ).length;
    return correct / validation.length;
  }, [examples]);

  const current = useMemo(() => {
    const unlabeled = expenses.filter((transaction) => !labels[transaction.id] && !skipped.has(transaction.id));
    if (!unlabeled.length) return null;
    const diningFirst = unlabeled.filter(isDiningTransaction);
    const priorityPool = diningFirst.length ? diningFirst : unlabeled;
    if (examples.length >= MIN_TRAINING_LABELS && weights) {
      return [...unlabeled].sort((a, b) => {
        const uncertaintyA = Math.abs((predictionById.get(a.id) || 0.5) - 0.5);
        const uncertaintyB = Math.abs((predictionById.get(b.id) || 0.5) - 0.5);
        return uncertaintyA - uncertaintyB || stableHash(a.id) - stableHash(b.id);
      })[0];
    }

    const bucket = examples.length % 4;
    const stratified = priorityPool.filter((transaction) => {
      if (bucket === 0) return transaction.nextDayDeposit > 0;
      if (bucket === 1) return transaction.amount >= 50_000;
      if (bucket === 2) return transaction.amount >= 20_000 && transaction.amount < 50_000;
      return transaction.nextDayDeposit === 0 && transaction.amount < 30_000;
    });
    const pool = stratified.length ? stratified : priorityPool;
    return [...pool].sort((a, b) => stableHash(a.id) - stableHash(b.id))[0];
  }, [expenses, labels, skipped, examples.length, weights, predictionById]);

  const followingDeposits = useMemo(
    () => current && analysis
      ? analysis.deposits.filter((deposit) => deposit.date === nextDate(current.date)).sort((a, b) => b.amount - a.amount)
      : [],
    [current, analysis],
  );

  const sharedLabels = examples.filter((example) => example.label === "shared").length;
  const personalLabels = examples.length - sharedLabels;
  const stage = modelStage(examples.length);
  const confidentShared = predictions.filter((item) => !labels[item.transaction.id] && item.probability >= 0.7).length;
  const uncertain = predictions.filter((item) => !labels[item.transaction.id] && item.probability > 0.3 && item.probability < 0.7).length;
  const modelReady = examples.length >= MIN_TRAINING_LABELS && Boolean(weights);
  const confirmedSharedCount = predictions.filter((item) =>
    labels[item.transaction.id] === "shared"
    || (!labels[item.transaction.id] && modelReady && item.probability >= 0.7),
  ).length;
  const personalCount = predictions.filter((item) =>
    labels[item.transaction.id] === "personal"
    || (!labels[item.transaction.id] && modelReady && item.probability <= 0.3),
  ).length;
  const approvalNeededCount = modelReady ? uncertain : Math.max(0, expenses.length - examples.length);
  const classificationCoverage = expenses.length
    ? Math.round(((expenses.length - approvalNeededCount) / expenses.length) * 100)
    : 0;
  const remainingDiningCount = expenses.filter(
    (transaction) => isDiningTransaction(transaction) && !labels[transaction.id],
  ).length;

  const monthlyOverview = useMemo(() => {
    const grouped = new Map<string, { total: number; shared: number }>();
    predictions.forEach(({ transaction, probability }) => {
      const month = transaction.date.slice(0, 7);
      const currentMonth = grouped.get(month) || { total: 0, shared: 0 };
      currentMonth.total += 1;
      if (labels[transaction.id] === "shared" || (!labels[transaction.id] && modelReady && probability >= 0.7)) {
        currentMonth.shared += 1;
      }
      grouped.set(month, currentMonth);
    });
    return [...grouped.entries()]
      .sort(([monthA], [monthB]) => monthA.localeCompare(monthB))
      .slice(-12)
      .map(([month, values]) => ({ month, ...values }));
  }, [predictions, labels, modelReady]);
  const maxMonthlyShared = Math.max(...monthlyOverview.map((item) => item.shared), 1);

  const visiblePredictions = useMemo(() => {
    const filtered = predictions.filter((item) => {
      if (predictionFilter === "shared") return item.probability >= 0.7;
      if (predictionFilter === "personal") return item.probability <= 0.3;
      if (predictionFilter === "review") return item.probability > 0.3 && item.probability < 0.7;
      return true;
    });
    return filtered
      .sort((a, b) => Math.abs(b.probability - 0.5) - Math.abs(a.probability - 0.5))
      .slice(0, 18);
  }, [predictions, predictionFilter]);

  const labelCurrent = useCallback(async (label: LabelValue) => {
    if (!current || saving) return;
    setSaving(true);
    const optimistic: LabelRecord = { transactionId: current.id, label, updatedAt: new Date().toISOString() };
    setLabels((saved) => ({ ...saved, [current.id]: label }));
    setHistory((saved) => [optimistic, ...saved.filter((item) => item.transactionId !== current.id)]);
    if (demoMode) {
      setNotice("데모 세션에만 반영했습니다. 서버에는 저장되지 않습니다.");
      window.setTimeout(() => setNotice(""), 1800);
      setSaving(false);
      return;
    }
    try {
      const response = await fetch("/api/v2-training", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionId: current.id, label }),
      });
      if (!response.ok) throw new Error();
      setNotice(label === "shared" ? "공동지출 정답을 학습했습니다." : "개인지출 정답을 학습했습니다.");
      window.setTimeout(() => setNotice(""), 1400);
    } catch {
      setLabels((saved) => {
        const next = { ...saved };
        delete next[current.id];
        return next;
      });
      setHistory((saved) => saved.filter((item) => item.transactionId !== current.id));
      setNotice("저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }, [current, demoMode, saving]);

  const undoLast = useCallback(async () => {
    const latest = history[0];
    if (!latest || saving) return;
    setSaving(true);
    if (demoMode) {
      setLabels((saved) => {
        const next = { ...saved };
        delete next[latest.transactionId];
        return next;
      });
      setHistory((saved) => saved.slice(1));
      setNotice("데모 세션의 마지막 선택을 되돌렸습니다.");
      window.setTimeout(() => setNotice(""), 1400);
      setSaving(false);
      return;
    }
    const response = await fetch(`/api/v2-training?transactionId=${encodeURIComponent(latest.transactionId)}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setLabels((saved) => {
        const next = { ...saved };
        delete next[latest.transactionId];
        return next;
      });
      setHistory((saved) => saved.slice(1));
      setNotice("마지막 분류를 되돌렸습니다.");
      window.setTimeout(() => setNotice(""), 1400);
    } else {
      setNotice("되돌리지 못했습니다.");
    }
    setSaving(false);
  }, [demoMode, history, saving]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (workspaceTab !== "learning") return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button")) return;
      if (event.key === "1") void labelCurrent("personal");
      if (event.key === "2") void labelCurrent("shared");
      if (event.key.toLowerCase() === "s" && current) {
        setSkipped((saved) => new Set(saved).add(current.id));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [current, labelCurrent, workspaceTab]);

  if (!analysis) {
    return <main className="loading-shell"><div className="loading-mark">V2</div><p>학습 데이터를 준비하고 있어요</p></main>;
  }

  const currentProbability = current ? predictionById.get(current.id) || 0.5 : 0.5;
  const currentAmbiguity = Math.round(100 - Math.abs(currentProbability - 0.5) * 200);

  return (
    <main className="v2-shell">
      <header className="v2-topbar">
        <AppLink className="brand" href="/v2/"><span className="brand-mark v2-mark">V2</span><span>우리지출 LAB</span></AppLink>
        <nav aria-label="버전 메뉴"><AppLink href="/">규칙형 Ver.1</AppLink><button className={workspaceTab === "learning" ? "active" : ""} onClick={() => setWorkspaceTab("learning")}>학습 대시보드</button><button className={workspaceTab === "tree" ? "active" : ""} onClick={() => setWorkspaceTab("tree")}>규칙 발견</button></nav>
        <div className="v2-label-count"><span>{money.format(examples.length)}</span>건 학습됨</div>
      </header>

      {demoMode && (
        <aside className="demo-banner v2-demo-banner" role="note">
          <strong>PUBLIC DEMO</strong>
          <span>익명화 샘플 15건으로 모델 흐름을 체험할 수 있습니다. 선택은 현재 브라우저 세션에만 반영됩니다.</span>
          <em>개인 데이터·서버 저장 없음</em>
        </aside>
      )}

      {workspaceTab === "tree" ? <DecisionTreeLab transactions={expenses} labels={labels} /> : <>
      <section className="v2-hero">
        <div>
          <p className="v2-kicker">SUPERVISED LEARNING · PERSONAL MODEL</p>
          <h1>정답을 알려줄수록,<br /><em>나를 닮아가는 분류기.</em></h1>
          <p>거래와 다음날 입금을 함께 보고 공동지출인지 선택하세요.<br />규칙 대신 당신의 선택 패턴으로 새 거래를 분류합니다.</p>
        </div>
        <article className="model-card">
          <div className="model-card-head"><span>MODEL STATUS</span><i className={modelReady ? "ready" : ""} /></div>
          <strong>{stage.name}</strong>
          <p>{stage.note}</p>
          <div className="goal-line"><span>첫 학습 목표</span><b>{Math.min(examples.length, 100)} / 100</b></div>
          <div className="v2-progress"><i style={{ width: `${Math.min(100, examples.length)}%` }} /></div>
          <div className="model-mini-stats"><span>공동 <b>{sharedLabels}</b></span><span>개인 <b>{personalLabels}</b></span><span>검증 <b>{validationAccuracy === null ? "—" : `${Math.round(validationAccuracy * 100)}%`}</b></span></div>
        </article>
      </section>

      <section className="v2-overview" id="overview">
        <div className="v2-section-heading light">
          <div><p className="v2-kicker">OVERVIEW</p><h2>한눈에 보는 학습 결과</h2></div>
          <p>확률 70% 이상은 자동 확정, 30–70%는 승인 필요로 분류합니다.</p>
        </div>

        <div className="v2-stat-grid">
          <article className="v2-stat-card base"><span className="v2-stat-icon">⌁</span><p>전체 거래</p><strong>{money.format(expenses.length)}<small>건</small></strong><span>학습·자동분류 전체 대상</span></article>
          <article className="v2-stat-card warning"><span className="v2-stat-icon">!</span><p>승인 필요</p><strong>{money.format(approvalNeededCount)}<small>건</small></strong><span>공동지출 확률 30–70%</span></article>
          <article className="v2-stat-card shared"><span className="v2-stat-icon">✓</span><p>공동지출 확정</p><strong>{money.format(confirmedSharedCount)}<small>건</small></strong><span>정답 또는 확률 70% 이상</span></article>
          <article className="v2-stat-card learned"><span className="v2-stat-icon">↗</span><p>학습 완료</p><strong>{money.format(examples.length)}<small>건</small></strong><span>공동 {sharedLabels} · 개인 {personalLabels}</span></article>
        </div>

        <div className="v2-insight-grid">
          <article className="v2-chart-card">
            <div className="v2-card-title-row"><div><p className="v2-kicker">LAST 12 MONTHS</p><h3>월별 공동지출 확정</h3></div><span><i /> 확정 건수</span></div>
            <div className="v2-bar-chart" aria-label="최근 12개월 공동지출 확정 건수">
              {monthlyOverview.map((item) => (
                <div className="v2-bar-column" key={item.month} title={`${item.month}: ${item.shared}건 / 전체 ${item.total}건`}>
                  <b>{item.shared}</b><div><i style={{ height: `${Math.max(5, (item.shared / maxMonthlyShared) * 100)}%` }} /></div><span>{item.month.slice(5)}월</span>
                </div>
              ))}
            </div>
          </article>
          <article className="v2-coverage-card">
            <p className="v2-kicker">MODEL COVERAGE</p><h3>자동분류 커버리지</h3><strong>{classificationCoverage}<small>%</small></strong>
            <div className="coverage-track"><i className="coverage-shared" style={{ width: `${expenses.length ? (confirmedSharedCount / expenses.length) * 100 : 0}%` }} /><i className="coverage-review" style={{ width: `${expenses.length ? (approvalNeededCount / expenses.length) * 100 : 0}%` }} /><i className="coverage-personal" style={{ width: `${expenses.length ? (personalCount / expenses.length) * 100 : 0}%` }} /></div>
            <div className="coverage-row shared"><span>공동지출 확정</span><b>{money.format(confirmedSharedCount)}건</b></div>
            <div className="coverage-row review"><span>승인 필요</span><b>{money.format(approvalNeededCount)}건</b></div>
            <div className="coverage-row personal"><span>개인지출</span><b>{money.format(personalCount)}건</b></div>
            <p className="coverage-note">라벨을 추가할수록 승인 필요 거래가 줄어듭니다.</p>
          </article>
        </div>
      </section>

      <section className="training-section" id="training">
        <div className="v2-section-heading">
          <div><p className="v2-kicker">TEACH THE MODEL</p><h2>이 거래는 공동지출인가요?</h2></div>
          <p>{modelReady ? "남은 전체 거래 중 모델 확신이 가장 낮은 순서예요." : `음식점·카페 ${remainingDiningCount}건을 우선 보여드려요.`}</p>
        </div>

        <div className="training-grid">
          <article className="label-card">
            {current ? (
              <>
                <div className="label-card-meta"><span>{current.date}</span><b>{current.industry || "미분류"}</b>{modelReady ? <em>애매함 {currentAmbiguity}%</em> : isDiningTransaction(current) && <em>음식점·카페 우선</em>}</div>
                <h3>{current.merchant}</h3>
                <strong className="focus-amount">{formatMoney(current.amount)}</strong>
                {modelReady && <div className="model-guess"><span>현재 모델 예상</span><b>{Math.round(currentProbability * 100)}% 공동지출</b></div>}

                <div className="bundle-grid">
                  <section>
                    <div className="bundle-title"><span>카드</span><b>선택한 카드 거래</b><em>1건</em></div>
                    <div className="bundle-list">
                      <div className="current"><span>{current.merchant}<small>{current.date} · {current.industry || "미분류"}</small></span><b>{formatMoney(current.amount)}</b></div>
                    </div>
                  </section>
                  <section>
                    <div className="bundle-title mint"><span>입금</span><b>다음날 입금</b><em>{formatMoney(followingDeposits.reduce((sum, item) => sum + item.amount, 0))}</em></div>
                    <div className="bundle-list">
                      {followingDeposits.length ? followingDeposits.slice(0, 5).map((deposit, index) => (
                        <div key={`${deposit.date}-${deposit.memo}-${deposit.amount}-${index}`}><span>{deposit.memo}</span><b>+{formatMoney(deposit.amount)}</b></div>
                      )) : <p className="no-deposit">연결할 입금이 없습니다.</p>}
                    </div>
                  </section>
                </div>

                <div className="label-actions">
                  <button className="personal-choice" disabled={saving} onClick={() => void labelCurrent("personal")}><kbd>1</kbd><span>아니요</span><b>개인지출</b></button>
                  <button className="shared-choice" disabled={saving} onClick={() => void labelCurrent("shared")}><kbd>2</kbd><span>맞아요</span><b>공동지출</b></button>
                </div>
                <div className="label-tools"><button onClick={() => setSkipped((saved) => new Set(saved).add(current.id))}>이번 거래 건너뛰기 <kbd>S</kbd></button><button disabled={!history.length || saving} onClick={() => void undoLast()}>마지막 선택 되돌리기</button></div>
              </>
            ) : <div className="queue-complete"><b>✓</b><h3>모든 거래를 분류했어요</h3><p>건너뛴 거래를 다시 보려면 새로고침해 주세요.</p></div>}
          </article>

          <aside className="learning-side">
            <article>
              <p className="v2-kicker">LIVE LEARNING</p>
              <h3>학습 신호</h3>
              <div className="signal-row"><span>지출 금액</span><i style={{ width: `${Math.min(100, normalizedLog(current?.amount || 0) * 75)}%` }} /></div>
              <div className="signal-row"><span>다음날 입금</span><i style={{ width: `${Math.min(100, normalizedLog(current?.nextDayDeposit || 0) * 75)}%` }} /></div>
              <div className="signal-row"><span>입금/지출 비율</span><i style={{ width: `${Math.min(100, ((current?.nextDayDeposit || 0) / Math.max(1, current?.amount || 1)) * 100)}%` }} /></div>
              <p className="signal-note">개별 거래 금액, 입금 비율, 요일, 가맹점과 업종 패턴의 가중치를 정답마다 다시 계산합니다.</p>
            </article>
            <article className="recent-labels">
              <div className="recent-head"><h3>최근에 가르친 정답</h3><span>{history.length}건</span></div>
              {history.slice(0, 5).map((record) => {
                const transaction = transactionById.get(record.transactionId);
                return transaction ? <div key={record.transactionId}><span>{transaction.merchant}</span><b className={record.label}>{record.label === "shared" ? "공동" : "개인"}</b></div> : null;
              })}
              {!history.length && <p className="recent-empty">첫 거래를 분류하면 여기에 기록됩니다.</p>}
            </article>
          </aside>
        </div>
      </section>

      <section className="prediction-section" id="predictions">
        <div className="v2-section-heading light">
          <div><p className="v2-kicker">MODEL OUTPUT</p><h2>학습 기반 자동분류</h2></div>
          <p>{modelReady ? `자동 공동 ${confidentShared}건 · 추가 학습 필요 ${uncertain}건` : `정답을 ${MIN_TRAINING_LABELS - examples.length}건 더 입력하면 활성화됩니다.`}</p>
        </div>
        {!modelReady ? (
          <div className="prediction-lock"><span>{examples.length} / {MIN_TRAINING_LABELS}</span><h3>첫 모델을 준비하고 있어요</h3><p>공동지출과 개인지출 정답이 모두 포함되도록 분류해 주세요.</p></div>
        ) : (
          <>
            <div className="prediction-tabs">
              {(["all", "shared", "review", "personal"] as PredictionFilter[]).map((filter) => (
                <button className={predictionFilter === filter ? "active" : ""} key={filter} onClick={() => setPredictionFilter(filter)}>
                  {filter === "all" ? "전체" : filter === "shared" ? "자동 공동" : filter === "review" ? "추가 학습" : "자동 개인"}
                </button>
              ))}
            </div>
            <div className="prediction-table">
              {visiblePredictions.map(({ transaction, probability }) => {
                const actual = labels[transaction.id];
                const status = actual ? (actual === "shared" ? "학습 정답 · 공동" : "학습 정답 · 개인") : probability >= 0.7 ? "자동 공동" : probability <= 0.3 ? "자동 개인" : "추가 학습";
                return <article key={transaction.id}>
                  <div><span>{transaction.date}</span><h3>{transaction.merchant}</h3><small>{transaction.industry}</small></div>
                  <strong>{formatMoney(transaction.amount)}</strong>
                  <div className="probability"><span><i style={{ width: `${Math.round(probability * 100)}%` }} /></span><b>{Math.round(probability * 100)}%</b></div>
                  <em className={status.includes("공동") ? "shared" : status.includes("개인") ? "personal" : "review"}>{status}</em>
                </article>;
              })}
            </div>
          </>
        )}
      </section>
      </>}

      <footer className="v2-footer"><div className="brand"><span className="brand-mark v2-mark">V2</span><span>우리지출 LAB</span></div><p>{demoMode ? "공개 데모 · 선택은 세션에만 반영되며 서버에 저장되지 않습니다." : "정답은 서버에 저장되며, 모델은 규칙 판정 없이 라벨 패턴으로 다시 학습됩니다."}</p></footer>
      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}
