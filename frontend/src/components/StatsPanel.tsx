import { useMemo } from "react";
import { Activity, BarChart3, Target, TrendingUp, Waves } from "lucide-react";

import type { SnapshotSummary } from "../types/domain";
import { aggregate, directionAccuracyDistribution, groupByScenario } from "../utils/stats";

function fmtPct(value: number | null, digits = 1) {
  return value === null ? "-" : `${value.toFixed(digits)}%`;
}

function fmtNum(value: number | null, digits = 2) {
  return value === null ? "-" : value.toFixed(digits);
}

// 方向命中率相对 50%（抛硬币基准）的差值，决定语气是积极还是中性。
function edgeTone(accuracy: number | null): "good" | "flat" | "bad" {
  if (accuracy === null) return "flat";
  if (accuracy >= 55) return "good";
  if (accuracy < 48) return "bad";
  return "flat";
}

// 波动率预测的 R²：>0 说明比“直接猜平均波动”更准，是论文里 Kronos 的强项维度。
function volTone(r2: number | null): "good" | "flat" | "bad" {
  if (r2 === null) return "flat";
  if (r2 >= 0.1) return "good";
  if (r2 < 0) return "bad";
  return "flat";
}

export function StatsPanel({ snapshots }: { snapshots: SnapshotSummary[] }) {
  const overall = useMemo(() => aggregate(snapshots), [snapshots]);
  const groups = useMemo(() => groupByScenario(snapshots), [snapshots]);
  const distribution = useMemo(() => directionAccuracyDistribution(snapshots), [snapshots]);
  const maxBucket = Math.max(1, ...distribution.map((bucket) => bucket.count));

  if (overall.count === 0) {
    return (
      <div className="stats-empty">
        <BarChart3 size={32} />
        <p>还没有已评估的快照。</p>
        <small>先运行预测生成快照，待预测窗口走完后点「评估」，统计数据会自动汇总到这里。</small>
      </div>
    );
  }

  const tone = edgeTone(overall.meanDirectionAccuracy);

  return (
    <div className="stats-view">
      <div className="stats-note">
        Kronos 的强项是统计层面的方向与排序信号，而非精确点位。下列指标基于 {overall.count} 个已评估快照汇总，
        方向命中率应对照 50%（抛硬币）基准来读。混合多个周期时，波动率仅看相对误差；R² 因量纲不可跨周期池化，请在下方分场景明细中逐组查看。
      </div>

      <section className="stats-cards">
        <div className={`stats-card tone-${tone}`}>
          <div className="stats-card-head">
            <Target size={16} />
            <span>平均方向命中率</span>
          </div>
          <strong>{fmtPct(overall.meanDirectionAccuracy)}</strong>
          <small>基准 50% · 端点方向 {fmtPct(overall.terminalDirectionHitRate)}</small>
        </div>
        <div className="stats-card">
          <div className="stats-card-head">
            <Activity size={16} />
            <span>平均收盘 MAPE</span>
          </div>
          <strong>{fmtPct(overall.meanMape, 2)}</strong>
          <small>越低越好 · RMSE {fmtNum(overall.meanRmse)}</small>
        </div>
        <div className="stats-card">
          <div className="stats-card-head">
            <TrendingUp size={16} />
            <span>平均收盘相关性</span>
          </div>
          <strong>{fmtNum(overall.meanCorrelation, 3)}</strong>
          <small>-1~1 · 越接近 1 越同步</small>
        </div>
        <div className="stats-card">
          <div className="stats-card-head">
            <BarChart3 size={16} />
            <span>平均端点收益误差</span>
          </div>
          <strong>{fmtPct(overall.meanReturnError, 2)}</strong>
          <small>绝对值 · 越低越准</small>
        </div>
        <div className={`stats-card tone-${volTone(overall.volatilityR2)}`}>
          <div className="stats-card-head">
            <Waves size={16} />
            <span>波动率预测相对误差</span>
          </div>
          <strong>{fmtPct(overall.volatilityMape, 1)}</strong>
          <small>
            论文强项 · 越低越准 ·{" "}
            {overall.volatilityR2 === null
              ? "R² 需单一周期"
              : `单周期 R² ${fmtNum(overall.volatilityR2, 3)}`}
          </small>
        </div>
      </section>

      <section className="stats-block">
        <h3>方向命中率分布</h3>
        <div className="stats-dist">
          {distribution.map((bucket) => (
            <div key={bucket.label} className="stats-dist-row">
              <span className="stats-dist-label">{bucket.label}</span>
              <div className="stats-dist-track">
                <div
                  className={`stats-dist-bar${bucket.min >= 50 ? " above" : ""}`}
                  style={{ width: `${(bucket.count / maxBucket) * 100}%` }}
                />
              </div>
              <span className="stats-dist-count">{bucket.count}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="stats-block">
        <h3>分场景明细（交易对 × 周期 × 模型）</h3>
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>场景</th>
                <th>样本</th>
                <th>方向命中</th>
                <th>端点方向</th>
                <th>MAPE</th>
                <th>RMSE</th>
                <th>收益误差</th>
                <th>相关性</th>
                <th>波动率R²</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.key}>
                  <td className="stats-scenario">
                    <strong>{group.symbol}</strong>
                    <span>{group.timeframe} · {group.modelKey}</span>
                  </td>
                  <td>{group.count}</td>
                  <td className={`tone-text-${edgeTone(group.meanDirectionAccuracy)}`}>
                    {fmtPct(group.meanDirectionAccuracy)}
                  </td>
                  <td>{fmtPct(group.terminalDirectionHitRate)}</td>
                  <td>{fmtPct(group.meanMape, 2)}</td>
                  <td>{fmtNum(group.meanRmse)}</td>
                  <td>{fmtPct(group.meanReturnError, 2)}</td>
                  <td>{fmtNum(group.meanCorrelation, 3)}</td>
                  <td className={`tone-text-${volTone(group.volatilityR2)}`}>{fmtNum(group.volatilityR2, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
