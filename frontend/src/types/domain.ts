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
  input_start: string;
  input_end: string;
  prediction_start: string;
  prediction_end: string;
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

