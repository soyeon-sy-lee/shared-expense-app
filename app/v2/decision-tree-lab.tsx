"use client";

import { useMemo, useState } from "react";

type Transaction = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  industry: string;
  nextDayDeposit: number;
};

type LabelValue = "shared" | "personal";
type TrainingRow = { transaction: Transaction; label: LabelValue };
type Feature = {
  key: string;
  label: string;
  kind: "number" | "boolean" | "ratio";
  value: (transaction: Transaction) => number;
};
type TreeNode = {
  id: number;
  depth: number;
  samples: number;
  shared: number;
  personal: number;
  probability: number;
  prediction: LabelValue;
  feature?: Feature;
  threshold?: number;
  gain?: number;
  left?: TreeNode;
  right?: TreeNode;
};
type PathStep = { nodeId: number; childId: number; edge: "left" | "right"; explanation: string };

const money = new Intl.NumberFormat("ko-KR");
const CATEGORY_KEYWORDS = {
  dining: ["한식", "중식", "일식", "양식", "음식점", "주점", "음료", "커피", "카페", "스타벅스", "투썸", "치킨", "피자", "스시", "배민", "요기요", "쿠팡이츠"],
  medical: ["약국", "병원", "의원", "내과", "외과", "치과", "안과", "이비인후과", "피부과", "한의", "의료", "건강검진", "약품"],
  telecom: ["통신비", "통신요금", "휴대폰", "LGU+", "SKT", "KT통신", "케이티통신"],
  shopping: ["쇼핑", "백화점", "마트", "화장품", "의류", "생활용품", "잡화", "문구", "서적", "쿠팡", "지마켓", "SSG.COM", "올리브영", "오늘의집", "다이소", "무신사", "지그재그"],
  transport: ["택시", "버스", "지하철", "철도", "항공", "티머니", "주차", "주유"],
  education: ["학원", "스터디", "독서실", "아카데미", "교육", "고시"],
  convenience: ["편의점", "CU", "GS25", "세븐일레븐", "이마트24"],
};

function includesKeyword(transaction: Transaction, keywords: string[]) {
  const text = `${transaction.industry} ${transaction.merchant}`.replace(/\s+/g, "").toLowerCase();
  return keywords.some((keyword) => text.includes(keyword.replace(/\s+/g, "").toLowerCase()));
}

function weekend(transaction: Transaction) {
  const day = new Date(`${transaction.date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6 ? 1 : 0;
}

const FEATURES: Feature[] = [
  { key: "amount", label: "지출액", kind: "number", value: (transaction) => transaction.amount },
  { key: "deposit", label: "다음날 입금액", kind: "number", value: (transaction) => transaction.nextDayDeposit },
  { key: "depositRatio", label: "입금액 ÷ 지출액", kind: "ratio", value: (transaction) => transaction.nextDayDeposit / Math.max(1, transaction.amount) },
  { key: "hasDeposit", label: "다음날 입금이 있는 거래", kind: "boolean", value: (transaction) => transaction.nextDayDeposit > 0 ? 1 : 0 },
  { key: "dining", label: "음식점·카페 거래", kind: "boolean", value: (transaction) => includesKeyword(transaction, CATEGORY_KEYWORDS.dining) ? 1 : 0 },
  { key: "medical", label: "의료 거래", kind: "boolean", value: (transaction) => includesKeyword(transaction, CATEGORY_KEYWORDS.medical) ? 1 : 0 },
  { key: "telecom", label: "통신비 거래", kind: "boolean", value: (transaction) => includesKeyword(transaction, CATEGORY_KEYWORDS.telecom) ? 1 : 0 },
  { key: "shopping", label: "쇼핑 거래", kind: "boolean", value: (transaction) => includesKeyword(transaction, CATEGORY_KEYWORDS.shopping) ? 1 : 0 },
  { key: "transport", label: "교통 거래", kind: "boolean", value: (transaction) => includesKeyword(transaction, CATEGORY_KEYWORDS.transport) ? 1 : 0 },
  { key: "education", label: "교육·스터디 거래", kind: "boolean", value: (transaction) => includesKeyword(transaction, CATEGORY_KEYWORDS.education) ? 1 : 0 },
  { key: "convenience", label: "편의점 거래", kind: "boolean", value: (transaction) => includesKeyword(transaction, CATEGORY_KEYWORDS.convenience) ? 1 : 0 },
  { key: "weekend", label: "주말 거래", kind: "boolean", value: weekend },
];

function gini(rows: TrainingRow[]) {
  if (!rows.length) return 0;
  const shared = rows.filter((row) => row.label === "shared").length / rows.length;
  return 1 - shared ** 2 - (1 - shared) ** 2;
}

function thresholdCandidates(rows: TrainingRow[], feature: Feature) {
  if (feature.kind === "boolean") return [0.5];
  const values = [...new Set(rows.map((row) => feature.value(row.transaction)))].sort((a, b) => a - b);
  if (values.length < 2) return [];
  const midpoints = values.slice(0, -1).map((value, index) => (value + values[index + 1]) / 2);
  if (midpoints.length <= 24) return midpoints;
  return [...new Set(Array.from({ length: 24 }, (_, index) => midpoints[Math.floor(index * (midpoints.length - 1) / 23)]))];
}

function buildDecisionTree(rows: TrainingRow[]) {
  let nextId = 1;
  function build(nodeRows: TrainingRow[], depth: number): TreeNode {
    const shared = nodeRows.filter((row) => row.label === "shared").length;
    const personal = nodeRows.length - shared;
    const node: TreeNode = {
      id: nextId++, depth, samples: nodeRows.length, shared, personal,
      probability: nodeRows.length ? shared / nodeRows.length : 0,
      prediction: shared >= personal ? "shared" : "personal",
    };
    if (depth >= 3 || nodeRows.length < 20 || shared === 0 || personal === 0) return node;

    const parentImpurity = gini(nodeRows);
    let best: { feature: Feature; threshold: number; gain: number; left: TrainingRow[]; right: TrainingRow[] } | null = null;
    FEATURES.forEach((feature) => {
      thresholdCandidates(nodeRows, feature).forEach((threshold) => {
        const left = nodeRows.filter((row) => feature.value(row.transaction) <= threshold);
        const right = nodeRows.filter((row) => feature.value(row.transaction) > threshold);
        if (left.length < 8 || right.length < 8) return;
        const childImpurity = (left.length / nodeRows.length) * gini(left) + (right.length / nodeRows.length) * gini(right);
        const gain = parentImpurity - childImpurity;
        if (!best || gain > best.gain) best = { feature, threshold, gain, left, right };
      });
    });

    if (!best || best.gain < 0.004) return node;
    node.feature = best.feature;
    node.threshold = best.threshold;
    node.gain = best.gain;
    node.left = build(best.left, depth + 1);
    node.right = build(best.right, depth + 1);
    return node;
  }
  return build(rows, 0);
}

function countTree(node: TreeNode): { nodes: number; leaves: number; depth: number } {
  if (!node.left || !node.right) return { nodes: 1, leaves: 1, depth: node.depth };
  const left = countTree(node.left);
  const right = countTree(node.right);
  return { nodes: 1 + left.nodes + right.nodes, leaves: left.leaves + right.leaves, depth: Math.max(left.depth, right.depth) };
}

function leafFor(node: TreeNode, transaction: Transaction) {
  let current = node;
  while (current.feature && current.threshold !== undefined && current.left && current.right) {
    current = current.feature.value(transaction) <= current.threshold ? current.left : current.right;
  }
  return current;
}

function formatFeatureValue(feature: Feature, value: number) {
  if (feature.kind === "boolean") return value > 0.5 ? "예" : "아니요";
  if (feature.kind === "ratio") return `${Math.round(value * 100)}%`;
  return `${money.format(Math.round(value))}원`;
}

function nodeQuestion(node: TreeNode) {
  if (!node.feature || node.threshold === undefined) return "";
  if (node.feature.kind === "boolean") return `${node.feature.label}인가요?`;
  return `${node.feature.label}이 ${formatFeatureValue(node.feature, node.threshold)} 이하인가요?`;
}

function edgeLabel(node: TreeNode, edge: "left" | "right") {
  if (!node.feature || node.threshold === undefined) return "";
  if (node.feature.kind === "boolean") return edge === "left" ? "아니요" : "예";
  return edge === "left" ? `예 · ${formatFeatureValue(node.feature, node.threshold)} 이하` : `아니요 · 초과`;
}

function traceTree(root: TreeNode, transaction: Transaction) {
  const steps: PathStep[] = [];
  let node = root;
  while (node.feature && node.threshold !== undefined && node.left && node.right) {
    const value = node.feature.value(transaction);
    const edge = value <= node.threshold ? "left" : "right";
    const child = edge === "left" ? node.left : node.right;
    steps.push({
      nodeId: node.id,
      childId: child.id,
      edge,
      explanation: `${nodeQuestion(node)} 실제 값은 ${formatFeatureValue(node.feature, value)} → ${edgeLabel(node, edge)} 가지`,
    });
    node = child;
  }
  return { steps, leaf: node };
}

function TreeNodeView({ node, activeNodes, activeEdges }: { node: TreeNode; activeNodes: Set<number>; activeEdges: Set<string> }) {
  const leaf = !node.left || !node.right || !node.feature || node.threshold === undefined;
  return (
    <div className="tree-node-wrap">
      <article className={`tree-node ${leaf ? "leaf" : "split"} ${activeNodes.has(node.id) ? "active" : ""}`}>
        <div className="tree-node-head"><span>{leaf ? "LEAF" : `NODE ${node.id}`}</span><b>{node.samples}건</b></div>
        {leaf ? <h3>{node.prediction === "shared" ? "공동지출로 분류" : "개인지출로 분류"}</h3> : <h3>{nodeQuestion(node)}</h3>}
        <div className="tree-node-probability"><span><i style={{ width: `${Math.round(node.probability * 100)}%` }} /></span><b>공동 {Math.round(node.probability * 100)}%</b></div>
        <p>공동 {node.shared}건 · 개인 {node.personal}건{!leaf && node.gain !== undefined ? ` · 분리 개선 ${(node.gain * 100).toFixed(1)}%` : ""}</p>
      </article>
      {!leaf && node.left && node.right && (
        <div className="tree-children">
          {(["left", "right"] as const).map((edge) => {
            const child = edge === "left" ? node.left! : node.right!;
            return (
              <div className={`tree-child ${activeEdges.has(`${node.id}-${edge}`) ? "active" : ""}`} key={edge}>
                <span className="tree-edge-label">{edgeLabel(node, edge)}</span>
                <TreeNodeView node={child} activeNodes={activeNodes} activeEdges={activeEdges} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DecisionTreeLab({ transactions, labels }: { transactions: Transaction[]; labels: Record<string, LabelValue> }) {
  const rows = useMemo(() => transactions
    .filter((transaction) => labels[transaction.id])
    .map((transaction) => ({ transaction, label: labels[transaction.id] })), [transactions, labels]);
  const tree = useMemo(() => rows.length ? buildDecisionTree(rows) : null, [rows]);
  const [selectedId, setSelectedId] = useState("");
  const selected = rows.find((row) => row.transaction.id === selectedId) || rows[0] || null;
  const trace = tree && selected ? traceTree(tree, selected.transaction) : null;
  const activeNodes = new Set<number>(trace ? [tree!.id, ...trace.steps.map((step) => step.childId)] : []);
  const activeEdges = new Set<string>(trace?.steps.map((step) => `${step.nodeId}-${step.edge}`) || []);
  const treeSize = tree ? countTree(tree) : { nodes: 0, leaves: 0, depth: 0 };
  const accuracy = tree && rows.length
    ? rows.filter((row) => leafFor(tree, row.transaction).prediction === row.label).length / rows.length
    : 0;

  if (!tree || !selected) {
    return <section className="tree-lab empty"><h1>의사결정 트리를 만들 학습 데이터가 부족합니다.</h1><p>공동지출과 개인지출을 먼저 라벨링해 주세요.</p></section>;
  }

  return (
    <section className="tree-lab">
      <div className="tree-lab-hero">
        <div><p className="v2-kicker">DATA-DRIVEN RULE DISCOVERY</p><h1>내 선택에서 발견한<br /><em>의사결정 규칙.</em></h1><p>저장된 라벨만 사용해 지니 불순도를 가장 많이 줄이는 질문을 순서대로 찾았습니다.</p></div>
        <div className="tree-summary"><span><b>{rows.length}</b>학습 거래</span><span><b>{treeSize.nodes}</b>노드</span><span><b>{treeSize.depth}</b>최대 깊이</span><span><b>{Math.round(accuracy * 100)}%</b>학습 적합도</span></div>
      </div>

      <div className="tree-example-panel">
        <label htmlFor="tree-example">적용해 볼 학습 예제</label>
        <select id="tree-example" value={selected.transaction.id} onChange={(event) => setSelectedId(event.target.value)}>
          {rows.map((row) => <option key={row.transaction.id} value={row.transaction.id}>{row.transaction.date} · {row.transaction.merchant} · {money.format(row.transaction.amount)}원 · 정답 {row.label === "shared" ? "공동" : "개인"}</option>)}
        </select>
        <div className="selected-example-facts"><span>{selected.transaction.industry}</span><b>{money.format(selected.transaction.amount)}원</b><span>다음날 입금 {money.format(selected.transaction.nextDayDeposit)}원</span><em className={selected.label}>실제 정답 · {selected.label === "shared" ? "공동지출" : "개인지출"}</em></div>
      </div>

      <div className="tree-content-grid">
        <div className="tree-visual-panel">
          <div className="tree-panel-heading"><div><p className="v2-kicker">DECISION TREE</p><h2>노드와 분기</h2></div><p>보라색 경로는 선택한 예제가 지나간 길입니다.</p></div>
          <div className="tree-canvas" role="img" aria-label={`학습 데이터 ${rows.length}건으로 만든 깊이 ${treeSize.depth} 의사결정 트리`}>
            <TreeNodeView node={tree} activeNodes={activeNodes} activeEdges={activeEdges} />
          </div>
        </div>

        <aside className="tree-path-panel">
          <p className="v2-kicker">EXAMPLE PATH</p><h2>이 예제가 적용된 과정</h2>
          <ol>{trace!.steps.map((step, index) => <li key={step.nodeId}><span>{index + 1}</span><p>{step.explanation}</p></li>)}</ol>
          <div className={`tree-result ${trace!.leaf.prediction}`}><span>최종 노드 {trace!.leaf.id}</span><strong>{trace!.leaf.prediction === "shared" ? "공동지출" : "개인지출"}</strong><p>이 노드의 학습 거래 {trace!.leaf.samples}건 중 공동지출이 {trace!.leaf.shared}건이라 {Math.round(trace!.leaf.probability * 100)}%로 판단했습니다.</p></div>
          <p className="tree-caveat">학습 적합도는 현재 라벨을 얼마나 설명하는지 나타내며, 새로운 거래에서의 정확도와는 다릅니다.</p>
        </aside>
      </div>
    </section>
  );
}
