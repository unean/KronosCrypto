import type { Candle, MarketOption, PredictResponse, SnapshotDetail, SnapshotSummary, Timeframe } from "../types/domain";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8088/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? response.statusText);
  }

  return response.json() as Promise<T>;
}

export type MarketsResponse = {
  exchange: string;
  exchanges: { id: string; label: string }[];
  markets: MarketOption[];
  timeframes: Timeframe[];
  models: string[];
  default_pred_len: Record<Timeframe, number>;
};

export type PredictPayload = {
  symbol: string;
  timeframe: Timeframe;
  exchange: string;
  lookback: number;
  pred_len: number;
  model_key: string;
  device: string;
  temperature: number;
  top_p: number;
  sample_count: number;
  save_snapshot: boolean;
};

export const api = {
  markets: () => request<MarketsResponse>("/markets"),
  ohlcv: (symbol: string, timeframe: Timeframe, exchange: string, limit = 520) =>
    request<{ candles: Candle[] }>("/ohlcv", {
      method: "POST",
      body: JSON.stringify({ symbol, timeframe, limit, exchange }),
    }),
  predict: (payload: PredictPayload) =>
    request<PredictResponse>("/predict", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  snapshots: () => request<SnapshotSummary[]>("/snapshots"),
  snapshot: (id: number) => request<SnapshotDetail>(`/snapshots/${id}`),
  evaluate: (id: number) =>
    request<{ snapshot: SnapshotDetail; metrics: Record<string, number> }>(`/snapshots/${id}/evaluate`, {
      method: "POST",
    }),
};
