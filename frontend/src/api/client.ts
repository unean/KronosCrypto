import type { Candle, MarketOption, PredictResponse, SnapshotDetail, SnapshotSummary, Timeframe } from "../types/domain";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8088/api";

function errorMessage(detail: unknown, fallback: string) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) return String(item.msg);
        return "请求参数不合法";
      })
      .join("；");
  }
  return fallback || "请求失败";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(errorMessage(body.detail, response.statusText));
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
  candles?: Candle[];
};

export type OhlcvOptions = {
  limit?: number;
  start_time?: string;
  end_time?: string;
};

export const api = {
  markets: () => request<MarketsResponse>("/markets"),
  ohlcv: (symbol: string, timeframe: Timeframe, exchange: string, options: OhlcvOptions = {}) =>
    request<{ candles: Candle[] }>("/ohlcv", {
      method: "POST",
      body: JSON.stringify({ symbol, timeframe, exchange, limit: options.limit ?? 520, start_time: options.start_time, end_time: options.end_time }),
    }),
  predict: (payload: PredictPayload) =>
    request<PredictResponse>("/predict", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  snapshots: () => request<SnapshotSummary[]>("/snapshots"),
  snapshot: (id: number) => request<SnapshotDetail>(`/snapshots/${id}`),
  deleteSnapshot: (id: number) =>
    request<{ ok: boolean }>(`/snapshots/${id}`, {
      method: "DELETE",
    }),
  deleteSnapshots: (ids: number[]) =>
    request<{ ok: boolean; deleted: number }>("/snapshots/delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  evaluate: (id: number) =>
    request<{ snapshot: SnapshotDetail; metrics: Record<string, number> }>(`/snapshots/${id}/evaluate`, {
      method: "POST",
    }),
};
