import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Play,
  RefreshCcw,
  Save,
  Trash2,
  TrendingUp,
  Zap,
} from "lucide-react";

import { api, type MarketsResponse, type PredictPayload } from "./api/client";
import { CandleChart } from "./components/CandleChart";
import type { Candle, PredictionProbability, PredictResponse, SnapshotDetail, SnapshotSummary, Timeframe } from "./types/domain";
import { formatApiTime } from "./utils/time";
import "./styles.css";

const REFRESH_OPTIONS = [
  { label: "关闭", value: 0 },
  { label: "5 分钟", value: 5 * 60 * 1000 },
  { label: "15 分钟", value: 15 * 60 * 1000 },
  { label: "1 小时", value: 60 * 60 * 1000 },
  { label: "4 小时", value: 4 * 60 * 60 * 1000 },
];

const SNAPSHOT_PAGE_SIZE = 8;
const RANGE_SHORTCUTS = [
  { label: "最近1天", days: 1 },
  { label: "最近3天", days: 3 },
  { label: "最近7天", days: 7 },
];

function fmt(value: string) {
  return formatApiTime(value);
}

function snapshotStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "待评估",
    partial: "部分评估",
    evaluated: "已评估",
  };
  return labels[status] ?? status;
}

function fmtPct(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "-";
}

function toDateTimeLocal(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function localInputToIso(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return {
    start: toDateTimeLocal(start),
    end: toDateTimeLocal(end),
  };
}

function App() {
  const initialRange = useRef(defaultRange());
  const [meta, setMeta] = useState<MarketsResponse | null>(null);
  const [exchange, setExchange] = useState("binance");
  const [symbol, setSymbol] = useState("ETH/USDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [modelKey, setModelKey] = useState("kronos-base");
  const [device, setDevice] = useState("cpu");
  const [lookback, setLookback] = useState(400);
  const [predLen, setPredLen] = useState(48);
  const [sampleCount, setSampleCount] = useState(8);
  const [rangeStart, setRangeStart] = useState(initialRange.current.start);
  const [rangeEnd, setRangeEnd] = useState(initialRange.current.end);
  const [loadedRangeKey, setLoadedRangeKey] = useState<string | null>(null);
  const [refreshMs, setRefreshMs] = useState(0);
  const [history, setHistory] = useState<Candle[]>([]);
  const [prediction, setPrediction] = useState<Candle[]>([]);
  const [samplePaths, setSamplePaths] = useState<Candle[][]>([]);
  const [probability, setProbability] = useState<PredictionProbability | null>(null);
  const [actual, setActual] = useState<Candle[]>([]);
  const [lastRun, setLastRun] = useState<PredictResponse | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [snapshotPage, setSnapshotPage] = useState(1);
  const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<number[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<SnapshotDetail | null>(null);
  const [status, setStatus] = useState("空闲");
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    api.markets().then((data) => {
      setMeta(data);
      setPredLen(data.default_pred_len["15m"]);
    });
    loadSnapshots();
  }, []);

  useEffect(() => {
    if (!meta) return;
    setPredLen(meta.default_pred_len[timeframe]);
  }, [meta, timeframe]);

  useEffect(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (refreshMs > 0) {
      timerRef.current = window.setInterval(() => {
        runPrediction(false);
      }, refreshMs);
    }

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [refreshMs, exchange, symbol, timeframe, lookback, predLen, sampleCount, modelKey, device]);

  const chartActual = selectedSnapshot?.actual ?? actual;
  const chartHistory = selectedSnapshot?.history ?? history;
  const chartPrediction = selectedSnapshot?.prediction ?? prediction;
  const chartSamplePaths = selectedSnapshot?.sample_paths ?? samplePaths;
  const chartFocusTimestamp = selectedSnapshot?.prediction_start;
  const activeProbability = selectedSnapshot?.probability ?? probability;
  const currentRangeKey = rangeStart && rangeEnd ? `${exchange}|${symbol}|${timeframe}|${rangeStart}|${rangeEnd}` : null;

  const latestClose = useMemo(() => {
    const last = chartHistory.at(-1);
    return last ? last.close.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "-";
  }, [chartHistory]);

  const snapshotPageCount = Math.max(1, Math.ceil(snapshots.length / SNAPSHOT_PAGE_SIZE));
  const pagedSnapshots = snapshots.slice((snapshotPage - 1) * SNAPSHOT_PAGE_SIZE, snapshotPage * SNAPSHOT_PAGE_SIZE);
  const pagedSnapshotIds = pagedSnapshots.map((snapshot) => snapshot.id);
  const selectedSnapshotIdSet = useMemo(() => new Set(selectedSnapshotIds), [selectedSnapshotIds]);
  const isPageSelected = pagedSnapshotIds.length > 0 && pagedSnapshotIds.every((id) => selectedSnapshotIdSet.has(id));

  useEffect(() => {
    setSnapshotPage((page) => Math.min(page, snapshotPageCount));
  }, [snapshotPageCount]);

  async function loadSnapshots() {
    const data = await api.snapshots();
    setSnapshots(data);
    const availableIds = new Set(data.map((snapshot) => snapshot.id));
    setSelectedSnapshotIds((ids) => ids.filter((id) => availableIds.has(id)));
  }

  function toggleSnapshotSelection(id: number) {
    setSelectedSnapshotIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  }

  function togglePageSelection() {
    setSelectedSnapshotIds((ids) => {
      const current = new Set(ids);
      if (pagedSnapshotIds.every((id) => current.has(id))) {
        pagedSnapshotIds.forEach((id) => current.delete(id));
      } else {
        pagedSnapshotIds.forEach((id) => current.add(id));
      }
      return [...current];
    });
  }

  async function previewMarket() {
    setLoading(true);
    setStatus("正在获取已收盘 K 线");
    try {
      const hasRange = Boolean(rangeStart || rangeEnd);
      const response = await api.ohlcv(symbol, timeframe, exchange, hasRange ? {
        start_time: localInputToIso(rangeStart),
        end_time: localInputToIso(rangeEnd),
      } : { limit: 520 });
      setSelectedSnapshot(null);
      setHistory(response.candles);
      setPrediction([]);
      setSamplePaths([]);
      setProbability(null);
      setActual([]);
      setLoadedRangeKey(hasRange && rangeStart && rangeEnd ? `${exchange}|${symbol}|${timeframe}|${rangeStart}|${rangeEnd}` : null);
      setStatus(`已加载 ${response.candles.length} 根已收盘 K 线`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "行情数据获取失败");
    } finally {
      setLoading(false);
    }
  }

  function applyRangeShortcut(days: number) {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    setRangeStart(toDateTimeLocal(start));
    setRangeEnd(toDateTimeLocal(end));
  }

  function shiftRangeByDays(days: number) {
    if (!rangeStart || !rangeEnd) return;
    const shiftMs = days * 24 * 60 * 60 * 1000;
    setRangeStart(toDateTimeLocal(new Date(new Date(rangeStart).getTime() + shiftMs)));
    setRangeEnd(toDateTimeLocal(new Date(new Date(rangeEnd).getTime() + shiftMs)));
  }

  async function runPrediction(showBusy = true) {
    if (showBusy) setLoading(true);
    setStatus("正在运行 Kronos 预测");
    try {
      const payload: PredictPayload = {
        symbol,
        timeframe,
        exchange,
        lookback,
        pred_len: predLen,
        model_key: modelKey,
        device,
        temperature: 1,
        top_p: 0.9,
        sample_count: sampleCount,
        save_snapshot: true,
      };
      if (currentRangeKey && loadedRangeKey === currentRangeKey && history.length > 0) {
        payload.candles = history;
      }
      const response = await api.predict(payload);
      setSelectedSnapshot(null);
      setHistory(response.history);
      setPrediction(response.prediction);
      setSamplePaths(response.sample_paths ?? []);
      setProbability(response.probability);
      setActual([]);
      setLastRun(response);
      setStatus(`预测已保存为快照 #${response.snapshot_id}`);
      await loadSnapshots();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "预测失败");
    } finally {
      if (showBusy) setLoading(false);
    }
  }

  async function openSnapshot(id: number) {
    setLoading(true);
    try {
      const snapshot = await api.snapshot(id);
      setSelectedSnapshot(snapshot);
      setLoadedRangeKey(null);
      setStatus(`已打开快照 #${id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "快照加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function evaluateSnapshot(id: number) {
    setLoading(true);
    setStatus(`正在评估快照 #${id}`);
    try {
      const response = await api.evaluate(id);
      setSelectedSnapshot(response.snapshot);
      setStatus(`快照 #${id} 评估完成`);
      await loadSnapshots();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "评估失败");
    } finally {
      setLoading(false);
    }
  }

  async function deleteSnapshot(id: number) {
    if (!window.confirm(`删除快照 #${id}？`)) return;

    setLoading(true);
    setStatus(`正在删除快照 #${id}`);
    try {
      await api.deleteSnapshot(id);
      setSelectedSnapshotIds((ids) => ids.filter((item) => item !== id));
      if (selectedSnapshot?.id === id) {
        setSelectedSnapshot(null);
        setHistory([]);
        setPrediction([]);
        setSamplePaths([]);
        setProbability(null);
        setActual([]);
        setLoadedRangeKey(null);
      }
      await loadSnapshots();
      setStatus(`快照 #${id} 已删除`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除失败");
    } finally {
      setLoading(false);
    }
  }

  async function deleteSelectedSnapshots() {
    if (!selectedSnapshotIds.length) return;
    if (!window.confirm(`删除选中的 ${selectedSnapshotIds.length} 个快照？`)) return;

    setLoading(true);
    setStatus(`正在删除 ${selectedSnapshotIds.length} 个快照`);
    try {
      const response = await api.deleteSnapshots(selectedSnapshotIds);
      if (selectedSnapshot && selectedSnapshotIds.includes(selectedSnapshot.id)) {
        setSelectedSnapshot(null);
        setHistory([]);
        setPrediction([]);
        setSamplePaths([]);
        setProbability(null);
        setActual([]);
        setLoadedRangeKey(null);
      }
      setSelectedSnapshotIds([]);
      await loadSnapshots();
      setStatus(`已删除 ${response.deleted} 个快照`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "批量删除失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BarChart3 size={24} />
          <div>
            <h1>Kronos Crypto</h1>
            <span>模型预测控制台</span>
          </div>
        </div>

        <section className="panel controls">
          <label>
            <span>交易所</span>
            <select value={exchange} onChange={(event) => setExchange(event.target.value)}>
              {(meta?.exchanges ?? [{ id: "binance", label: "Binance" }]).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>交易对</span>
            <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
              {(meta?.markets ?? []).map((market) => (
                <option key={market.symbol} value={market.symbol}>
                  {market.symbol}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>周期</span>
            <select value={timeframe} onChange={(event) => setTimeframe(event.target.value as Timeframe)}>
              {(["15m", "1h", "4h", "1d"] as Timeframe[]).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>模型</span>
            <select value={modelKey} onChange={(event) => setModelKey(event.target.value)}>
              {(meta?.models ?? ["kronos-base"]).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>历史 K 线数</span>
            <input min={32} max={2048} type="number" value={lookback} onChange={(event) => setLookback(Number(event.target.value))} />
          </label>

          <div className="range-block">
            <div className="range-title">
              <CalendarDays size={15} />
              <span>拉取时间段</span>
            </div>
            <div className="shortcut-row">
              {RANGE_SHORTCUTS.map((shortcut) => (
                <button key={shortcut.days} type="button" onClick={() => applyRangeShortcut(shortcut.days)} disabled={loading}>
                  {shortcut.label}
                </button>
              ))}
              <button type="button" onClick={() => shiftRangeByDays(-1)} disabled={loading || !rangeStart || !rangeEnd}>
                前一天
              </button>
              <button type="button" onClick={() => { setRangeStart(""); setRangeEnd(""); }} disabled={loading || (!rangeStart && !rangeEnd)}>
                最新
              </button>
            </div>
            <div className="range-inputs">
              <label>
                <span>开始</span>
                <input type="datetime-local" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
              </label>
              <label>
                <span>结束</span>
                <input type="datetime-local" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
              </label>
            </div>
          </div>

          <div className="split">
            <label>
              <span>设备</span>
              <select value={device} onChange={(event) => setDevice(event.target.value)}>
                <option value="cpu">CPU</option>
                <option value="mps">MPS</option>
                <option value="cuda:0">CUDA</option>
              </select>
            </label>
            <label>
              <span>预测步数</span>
              <input min={1} max={240} type="number" value={predLen} onChange={(event) => setPredLen(Number(event.target.value))} />
            </label>
          </div>

          <label>
            <span>采样路径数</span>
            <input min={1} max={50} type="number" value={sampleCount} onChange={(event) => setSampleCount(Number(event.target.value))} />
          </label>

          <label>
            <span>自动刷新</span>
            <select value={refreshMs} onChange={(event) => setRefreshMs(Number(event.target.value))}>
              {REFRESH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="button-row">
            <button type="button" onClick={previewMarket} disabled={loading} title="获取最新已收盘 K 线">
              <RefreshCcw size={16} />
              获取
            </button>
            <button type="button" className="primary" onClick={() => runPrediction(true)} disabled={loading} title="运行 Kronos 预测">
              <Play size={16} />
              预测
            </button>
          </div>
        </section>

        <section className="panel snapshots">
          <div className="panel-title">
            <Save size={16} />
            <h2>快照</h2>
          </div>
          <div className="snapshot-actions">
            <button type="button" onClick={togglePageSelection} disabled={!pagedSnapshotIds.length || loading}>
              {isPageSelected ? "取消本页" : "选择本页"}
            </button>
            <button type="button" onClick={() => setSelectedSnapshotIds([])} disabled={!selectedSnapshotIds.length || loading}>
              清空
            </button>
            <button type="button" className="danger-action" onClick={deleteSelectedSnapshots} disabled={!selectedSnapshotIds.length || loading}>
              <Trash2 size={15} />
              删除 {selectedSnapshotIds.length}
            </button>
          </div>
          <div className="snapshot-list">
            {pagedSnapshots.map((snapshot) => (
              <div key={snapshot.id} className="snapshot-item">
                <label className="snapshot-check" title={`选择快照 #${snapshot.id}`}>
                  <input
                    type="checkbox"
                    checked={selectedSnapshotIdSet.has(snapshot.id)}
                    onChange={() => toggleSnapshotSelection(snapshot.id)}
                    disabled={loading}
                  />
                </label>
                <button className="snapshot-open" type="button" onClick={() => openSnapshot(snapshot.id)}>
                  <strong>#{snapshot.id} {snapshot.symbol}</strong>
                  <span>{snapshot.timeframe} · {snapshotStatusLabel(snapshot.status)}</span>
                  <small>{fmt(snapshot.created_at)}</small>
                  {snapshot.metrics ? <em>平均绝对百分比误差 {snapshot.metrics.mape_close?.toFixed(2)}%</em> : null}
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  onClick={() => deleteSnapshot(snapshot.id)}
                  disabled={loading}
                  title={`删除快照 #${snapshot.id}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="pagination">
            <button
              className="icon-button"
              type="button"
              onClick={() => setSnapshotPage((page) => Math.max(1, page - 1))}
              disabled={snapshotPage <= 1}
              title="上一页"
            >
              <ChevronLeft size={16} />
            </button>
            <span>{snapshotPage} / {snapshotPageCount}</span>
            <button
              className="icon-button"
              type="button"
              onClick={() => setSnapshotPage((page) => Math.min(snapshotPageCount, page + 1))}
              disabled={snapshotPage >= snapshotPageCount}
              title="下一页"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="metric">
            <Activity size={18} />
            <span>最新收盘价</span>
            <strong>{latestClose}</strong>
          </div>
          <div className="metric">
            <Clock size={18} />
            <span>预测区间</span>
            <strong>{lastRun ? `${fmt(lastRun.prediction_start)} → ${fmt(lastRun.prediction_end)}` : "-"}</strong>
          </div>
          <div className="status-pill">
            <Zap size={16} />
            {loading ? "处理中" : status}
          </div>
        </header>

        <div className="chart-wrap">
          <CandleChart
            history={chartHistory}
            prediction={chartPrediction}
            samplePaths={chartSamplePaths}
            actual={chartActual}
            focusTimestamp={chartFocusTimestamp}
          />
        </div>

        {activeProbability ? (
          <section className="probability-bar">
            <div className="probability-title">
              <TrendingUp size={17} />
              概率预测 · {activeProbability.sample_count} 条采样路径 · 目标 {fmt(activeProbability.target_timestamp)}
            </div>
            <div className="probability-grid">
              <div>
                <span>高于现价</span>
                <strong>{fmtPct(activeProbability.chance_above_last_close)}</strong>
              </div>
              <div>
                <span>低于现价</span>
                <strong>{fmtPct(activeProbability.chance_below_last_close)}</strong>
              </div>
              <div>
                <span>未来波动更高</span>
                <strong>{fmtPct(activeProbability.chance_future_volatility_above_recent)}</strong>
              </div>
              <div>
                <span>预期收益</span>
                <strong>{fmtPct(activeProbability.expected_return_pct)}</strong>
              </div>
              <div>
                <span>收益区间 P10/P90</span>
                <strong>{fmtPct(activeProbability.p10_return_pct)} / {fmtPct(activeProbability.p90_return_pct)}</strong>
              </div>
              <div>
                <span>近期/未来波动</span>
                <strong>{fmtPct(activeProbability.recent_volatility_pct)} / {fmtPct(activeProbability.median_future_volatility_pct)}</strong>
              </div>
            </div>
          </section>
        ) : null}

        {selectedSnapshot ? (
          <section className="detail-bar">
            <div>
              <Database size={17} />
              快照 #{selectedSnapshot.id} · {selectedSnapshot.symbol} · {selectedSnapshot.timeframe}
            </div>
            <button type="button" onClick={() => evaluateSnapshot(selectedSnapshot.id)} disabled={loading}>
              评估
            </button>
            {selectedSnapshot.metrics ? (
              <div className="metrics">
                <span>平均绝对误差 {selectedSnapshot.metrics.mae_close?.toFixed(4)}</span>
                <span>均方根误差 {selectedSnapshot.metrics.rmse_close?.toFixed(4)}</span>
                <span>平均绝对百分比误差 {selectedSnapshot.metrics.mape_close?.toFixed(2)}%</span>
                <span>方向准确率 {selectedSnapshot.metrics.direction_accuracy?.toFixed(1)}%</span>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
