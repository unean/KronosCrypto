import type { SnapshotSummary } from "../types/domain";

// 只有评估过的快照才带有可统计的 metrics。partial 也纳入，但需要有 metrics。
export function isEvaluated(snapshot: SnapshotSummary): boolean {
  return Boolean(snapshot.metrics) && (snapshot.status === "evaluated" || snapshot.status === "partial");
}

function mean(values: number[]): number | null {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function metricValues(snapshots: SnapshotSummary[], key: string): number[] {
  return snapshots
    .map((snapshot) => snapshot.metrics?.[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export type AggregateStats = {
  count: number;
  meanDirectionAccuracy: number | null;
  meanMape: number | null;
  meanRmse: number | null;
  meanCorrelation: number | null;
  meanReturnError: number | null;
  // 端点方向命中率：预测的端点收益与实际端点收益同号的比例
  terminalDirectionHitRate: number | null;
  // 波动率预测准确度（Kronos 论文强项维度）
  volatilityMae: number | null;
  // 波动率平均相对误差 |pred-actual|/actual，跨周期可比的稳健口径
  volatilityMape: number | null;
  // 波动率 R²：仅在样本同属单一周期时才有意义（避免跨量纲池化的辛普森悖论假象）
  volatilityR2: number | null;
};

export function aggregate(snapshots: SnapshotSummary[]): AggregateStats {
  const evaluated = snapshots.filter(isEvaluated);

  const terminalPairs = evaluated
    .map((snapshot) => ({
      pred: snapshot.metrics?.pred_return_pct,
      actual: snapshot.metrics?.actual_return_pct,
    }))
    .filter(
      (pair): pair is { pred: number; actual: number } =>
        typeof pair.pred === "number" &&
        typeof pair.actual === "number" &&
        Number.isFinite(pair.pred) &&
        Number.isFinite(pair.actual),
    );
  const terminalHits = terminalPairs.filter((pair) => Math.sign(pair.pred) === Math.sign(pair.actual));

  // 波动率预测准确度：以实际波动为真值，预测波动为估计，算 MAE 与 R²。
  const volPairs = evaluated
    .map((snapshot) => ({
      pred: snapshot.metrics?.pred_volatility_pct,
      actual: snapshot.metrics?.actual_volatility_pct,
    }))
    .filter(
      (pair): pair is { pred: number; actual: number } =>
        typeof pair.pred === "number" &&
        typeof pair.actual === "number" &&
        Number.isFinite(pair.pred) &&
        Number.isFinite(pair.actual),
    );
  const volatilityMae = volPairs.length
    ? mean(volPairs.map((pair) => Math.abs(pair.pred - pair.actual)))
    : null;
  // 相对误差以实际波动为分母，无量纲，跨周期可比，适合做顶部卡片口径。
  const volatilityMape = volPairs.length
    ? mean(volPairs.map((pair) => Math.abs(pair.pred - pair.actual) / Math.max(Math.abs(pair.actual), 1e-9) * 100))
    : null;
  // R² 跨量纲池化会被组间方差撑高（如 4h 波动天然大于 15m），产生假阳性。
  // 仅当所有样本同属一个周期时才计算，否则置 null。
  const timeframes = new Set(evaluated.map((snapshot) => snapshot.timeframe));
  let volatilityR2: number | null = null;
  if (volPairs.length > 1 && timeframes.size === 1) {
    const actualMean = volPairs.reduce((sum, pair) => sum + pair.actual, 0) / volPairs.length;
    const ssRes = volPairs.reduce((sum, pair) => sum + (pair.actual - pair.pred) ** 2, 0);
    const ssTot = volPairs.reduce((sum, pair) => sum + (pair.actual - actualMean) ** 2, 0);
    volatilityR2 = ssTot > 0 ? 1 - ssRes / ssTot : null;
  }

  return {
    count: evaluated.length,
    meanDirectionAccuracy: mean(metricValues(evaluated, "direction_accuracy")),
    meanMape: mean(metricValues(evaluated, "mape_close")),
    meanRmse: mean(metricValues(evaluated, "rmse_close")),
    meanCorrelation: mean(metricValues(evaluated, "close_correlation")),
    meanReturnError: mean(metricValues(evaluated, "return_error_pct").map((value) => Math.abs(value))),
    terminalDirectionHitRate: terminalPairs.length ? (terminalHits.length / terminalPairs.length) * 100 : null,
    volatilityMae,
    volatilityMape,
    volatilityR2,
  };
}

export type GroupStats = AggregateStats & {
  key: string;
  symbol: string;
  timeframe: string;
  modelKey: string;
};

// 按 交易对 × 周期 × 模型 分组，看模型在哪些场景下相对更靠谱。
export function groupByScenario(snapshots: SnapshotSummary[]): GroupStats[] {
  const evaluated = snapshots.filter(isEvaluated);
  const groups = new Map<string, SnapshotSummary[]>();

  for (const snapshot of evaluated) {
    const key = `${snapshot.symbol}|${snapshot.timeframe}|${snapshot.model_key}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(snapshot);
    else groups.set(key, [snapshot]);
  }

  return [...groups.entries()]
    .map(([key, bucket]) => {
      const [symbol, timeframe, modelKey] = key.split("|");
      return { key, symbol, timeframe, modelKey, ...aggregate(bucket) };
    })
    .sort((a, b) => b.count - a.count);
}

// 把方向命中率按区间分桶，直观看出是否接近抛硬币。
export type AccuracyBucket = {
  label: string;
  min: number;
  max: number;
  count: number;
};

export function directionAccuracyDistribution(snapshots: SnapshotSummary[]): AccuracyBucket[] {
  const buckets: AccuracyBucket[] = [
    { label: "0-40%", min: 0, max: 40, count: 0 },
    { label: "40-50%", min: 40, max: 50, count: 0 },
    { label: "50-60%", min: 50, max: 60, count: 0 },
    { label: "60-100%", min: 60, max: 100.0001, count: 0 },
  ];

  for (const value of metricValues(snapshots.filter(isEvaluated), "direction_accuracy")) {
    const bucket = buckets.find((item) => value >= item.min && value < item.max);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}
