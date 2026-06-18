import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, BarChart3, Clock, Database, Play, RefreshCcw, Save, Zap } from "lucide-react";

import { api, type MarketsResponse, type PredictPayload } from "./api/client";
import { CandleChart } from "./components/CandleChart";
import type { Candle, PredictResponse, SnapshotDetail, SnapshotSummary, Timeframe } from "./types/domain";
import { formatApiTime } from "./utils/time";
import "./styles.css";

const REFRESH_OPTIONS = [
  { label: "关闭", value: 0 },
  { label: "5 分钟", value: 5 * 60 * 1000 },
  { label: "15 分钟", value: 15 * 60 * 1000 },
  { label: "1 小时", value: 60 * 60 * 1000 },
  { label: "4 小时", value: 4 * 60 * 60 * 1000 },
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

function App() {
  const [meta, setMeta] = useState<MarketsResponse | null>(null);
  const [exchange, setExchange] = useState("binance");
  const [symbol, setSymbol] = useState("ETH/USDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [modelKey, setModelKey] = useState("kronos-base");
  const [device, setDevice] = useState("cpu");
  const [lookback, setLookback] = useState(400);
  const [predLen, setPredLen] = useState(96);
  const [refreshMs, setRefreshMs] = useState(0);
  const [history, setHistory] = useState<Candle[]>([]);
  const [prediction, setPrediction] = useState<Candle[]>([]);
  const [actual, setActual] = useState<Candle[]>([]);
  const [lastRun, setLastRun] = useState<PredictResponse | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
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
  }, [refreshMs, exchange, symbol, timeframe, lookback, predLen, modelKey, device]);

  const chartActual = selectedSnapshot?.actual ?? actual;
  const chartHistory = selectedSnapshot?.history ?? history;
  const chartPrediction = selectedSnapshot?.prediction ?? prediction;
  const chartFocusTimestamp = selectedSnapshot?.prediction_start;

  const latestClose = useMemo(() => {
    const last = chartHistory.at(-1);
    return last ? last.close.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "-";
  }, [chartHistory]);

  async function loadSnapshots() {
    const data = await api.snapshots();
    setSnapshots(data);
  }

  async function previewMarket() {
    setLoading(true);
    setStatus("正在获取已收盘 K 线");
    try {
      const response = await api.ohlcv(symbol, timeframe, exchange, 520);
      setSelectedSnapshot(null);
      setHistory(response.candles);
      setPrediction([]);
      setActual([]);
      setStatus(`已加载 ${response.candles.length} 根已收盘 K 线`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "行情数据获取失败");
    } finally {
      setLoading(false);
    }
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
        sample_count: 1,
        save_snapshot: true,
      };
      const response = await api.predict(payload);
      setSelectedSnapshot(null);
      setHistory(response.history);
      setPrediction(response.prediction);
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
          <div className="snapshot-list">
            {snapshots.map((snapshot) => (
              <button key={snapshot.id} className="snapshot-item" type="button" onClick={() => openSnapshot(snapshot.id)}>
                <strong>#{snapshot.id} {snapshot.symbol}</strong>
                <span>{snapshot.timeframe} · {snapshotStatusLabel(snapshot.status)}</span>
                <small>{fmt(snapshot.created_at)}</small>
                {snapshot.metrics ? <em>平均绝对百分比误差 {snapshot.metrics.mape_close?.toFixed(2)}%</em> : null}
              </button>
            ))}
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
          <CandleChart history={chartHistory} prediction={chartPrediction} actual={chartActual} focusTimestamp={chartFocusTimestamp} />
        </div>

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
