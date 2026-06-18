import { useEffect, useRef } from "react";
import { CandlestickSeries, createChart, createSeriesMarkers, HistogramSeries, type UTCTimestamp } from "lightweight-charts";

import type { Candle } from "../types/domain";
import { formatUnixSecondsLocal, toUnixSeconds } from "../utils/time";

type Props = {
  history: Candle[];
  prediction: Candle[];
  actual?: Candle[];
  focusTimestamp?: string;
};

function toChartCandle(candle: Candle) {
  return {
    time: toUnixSeconds(candle.timestamp) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

function toVolume(candle: Candle, color: string) {
  return {
    time: toUnixSeconds(candle.timestamp) as UTCTimestamp,
    value: candle.volume,
    color,
  };
}

function normalizeSeries<T extends { time: UTCTimestamp }>(items: T[]) {
  const byTime = new Map<number, T>();
  for (const item of items) {
    byTime.set(Number(item.time), item);
  }
  return [...byTime.values()].sort((a, b) => Number(a.time) - Number(b.time));
}

export function CandleChart({ history, prediction, actual = [], focusTimestamp }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "#0d1117" },
        textColor: "#c9d1d9",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      },
      grid: {
        vertLines: { color: "#202832" },
        horzLines: { color: "#202832" },
      },
      rightPriceScale: {
        borderColor: "#30363d",
      },
      timeScale: {
        borderColor: "#30363d",
        timeVisible: true,
        tickMarkFormatter: (time: UTCTimestamp) => formatUnixSecondsLocal(Number(time)),
      },
      localization: {
        timeFormatter: (time: UTCTimestamp) => formatUnixSecondsLocal(Number(time)),
      },
      crosshair: {
        mode: 0,
      },
    });

    const historySeries = chart.addSeries(CandlestickSeries, {
      upColor: "#21c7a8",
      downColor: "#ef5b5b",
      borderUpColor: "#21c7a8",
      borderDownColor: "#ef5b5b",
      wickUpColor: "#21c7a8",
      wickDownColor: "#ef5b5b",
    });
    historySeries.setData(normalizeSeries(history.map(toChartCandle)));

    const predictionSeries = chart.addSeries(CandlestickSeries, {
      upColor: "rgba(42, 166, 255, 0.82)",
      downColor: "rgba(42, 166, 255, 0.52)",
      borderUpColor: "#2aa6ff",
      borderDownColor: "#7cc8ff",
      wickUpColor: "#2aa6ff",
      wickDownColor: "#7cc8ff",
    });
    const predictionData = normalizeSeries(prediction.map(toChartCandle));
    predictionSeries.setData(predictionData);

    if (predictionData.length) {
      createSeriesMarkers(predictionSeries, [
        {
          time: predictionData[0].time,
          position: "belowBar",
          color: "#2aa6ff",
          shape: "arrowUp",
          text: "预测起点",
        },
      ]);
    }

    if (actual.length) {
      const actualSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#21c7a8",
        downColor: "#ef5b5b",
        borderUpColor: "#21c7a8",
        borderDownColor: "#ef5b5b",
        wickUpColor: "#21c7a8",
        wickDownColor: "#ef5b5b",
      });
      actualSeries.setData(normalizeSeries(actual.map(toChartCandle)));
    }

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0,
      },
    });
    volumeSeries.setData(
      normalizeSeries([
        ...history.map((c) => toVolume(c, "rgba(117, 127, 140, 0.32)")),
        ...prediction.map((c) => toVolume(c, "rgba(42, 166, 255, 0.25)")),
      ]),
    );

    if (focusTimestamp) {
      const focusTime = toUnixSeconds(focusTimestamp);
      const times = normalizeSeries(
        [...history, ...prediction, ...actual].map((candle) => ({ time: toUnixSeconds(candle.timestamp) as UTCTimestamp })),
      );
      const focusIndex = times.findIndex((item) => Number(item.time) >= focusTime);
      const centerIndex = focusIndex >= 0 ? focusIndex : times.length - 1;
      const fromIndex = Math.max(0, centerIndex - 48);
      const toIndex = Math.min(times.length - 1, centerIndex + 96);

      if (times[fromIndex] && times[toIndex]) {
        chart.timeScale().setVisibleRange({
          from: times[fromIndex].time,
          to: times[toIndex].time,
        });
      } else {
        chart.timeScale().fitContent();
      }
    } else {
      chart.timeScale().fitContent();
    }

    return () => {
      chart.remove();
    };
  }, [history, prediction, actual, focusTimestamp]);

  return <div className="chart-surface" ref={containerRef} />;
}
