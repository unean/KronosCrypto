export type Timeframe = "15m" | "1h" | "4h" | "1d";

export type Candle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
};

export type MarketOption = {
  symbol: string;
  label: string;
};

export type PredictResponse = {
  snapshot_id: number | null;
  symbol: string;
  timeframe: Timeframe;
  history: Candle[];
  prediction: Candle[];
  sample_paths: Candle[][];
  probability: PredictionProbability | null;
  input_start: string;
  input_end: string;
  prediction_start: string;
  prediction_end: string;
};

export type PredictionProbability = {
  sample_count: number;
  chance_above_last_close: number;
  chance_below_last_close: number;
  chance_future_volatility_above_recent: number;
  expected_return_pct: number;
  median_return_pct: number;
  p10_return_pct: number;
  p90_return_pct: number;
  recent_volatility_pct: number;
  median_future_volatility_pct: number;
  target_steps: number;
  target_timestamp: string;
};

export type SnapshotSummary = {
  id: number;
  symbol: string;
  timeframe: Timeframe;
  exchange: string;
  model_key: string;
  status: string;
  created_at: string;
  prediction_start: string;
  prediction_end: string;
  metrics: Record<string, number> | null;
};

export type SnapshotDetail = SnapshotSummary & {
  history: Candle[];
  prediction: Candle[];
  actual: Candle[];
};
