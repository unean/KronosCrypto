import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type UTCTimestamp,
} from "lightweight-charts";

import type { Candle } from "../types/domain";
import { formatUnixSecondsLocal, toUnixSeconds } from "../utils/time";

type Props = {
  history: Candle[];
  prediction: Candle[];
  samplePaths?: Candle[][];
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

function percentile(values: number[], pct: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * pct;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function forecastEnvelope(samplePaths: Candle[][]) {
  if (!samplePaths.length || !samplePaths[0]?.length) return [];

  return samplePaths[0].map((candle, index) => {
    const closes = samplePaths.map((path) => path[index]?.close).filter((value): value is number => Number.isFinite(value));
    return {
      time: toUnixSeconds(candle.timestamp) as UTCTimestamp,
      lower: percentile(closes, 0.1),
      upper: percentile(closes, 0.9),
    };
  });
}

export function CandleChart({ history, prediction, samplePaths = [], actual = [], focusTimestamp }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const bandSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    bandSvg.classList.add("forecast-band");
    container.appendChild(bandSvg);

    const chart = createChart(container, {
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

    const envelope = forecastEnvelope(samplePaths);
    const envelopeUpperScaleSeries = chart.addSeries(LineSeries, {
      color: "rgba(255, 191, 71, 0)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    envelopeUpperScaleSeries.setData(normalizeSeries(envelope.map((point) => ({ time: point.time, value: point.upper }))));

    const envelopeLowerScaleSeries = chart.addSeries(LineSeries, {
      color: "rgba(255, 191, 71, 0)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    envelopeLowerScaleSeries.setData(normalizeSeries(envelope.map((point) => ({ time: point.time, value: point.lower }))));

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
        ...prediction.map((c) => toVolume(c, "rgba(255, 159, 28, 0.38)")),
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

    const drawForecastBand = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      bandSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      bandSvg.setAttribute("width", `${width}`);
      bandSvg.setAttribute("height", `${height}`);
      bandSvg.replaceChildren();

      if (envelope.length >= 2) {
        const upperPoints = envelope
          .map((point) => {
            const x = chart.timeScale().timeToCoordinate(point.time);
            const y = predictionSeries.priceToCoordinate(point.upper);
            return x === null || y === null ? null : { x: Number(x), y: Number(y) };
          })
          .filter((point) => point !== null);
        const lowerPoints = envelope
          .map((point) => {
            const x = chart.timeScale().timeToCoordinate(point.time);
            const y = predictionSeries.priceToCoordinate(point.lower);
            return x === null || y === null ? null : { x: Number(x), y: Number(y) };
          })
          .filter((point) => point !== null);

        if (upperPoints.length >= 2 && lowerPoints.length >= 2) {
          const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
          const points = [...upperPoints, ...lowerPoints.reverse()].map((point) => `${point.x},${point.y}`).join(" ");
          polygon.setAttribute("points", points);
          polygon.setAttribute("fill", "rgba(255, 159, 28, 0.22)");
          polygon.setAttribute("stroke", "rgba(255, 159, 28, 0.28)");
          polygon.setAttribute("stroke-width", "1");
          bandSvg.appendChild(polygon);
        }
      }

      if (predictionData.length) {
        const x = chart.timeScale().timeToCoordinate(predictionData[0].time);
        if (x !== null) {
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", `${x}`);
          line.setAttribute("x2", `${x}`);
          line.setAttribute("y1", "0");
          line.setAttribute("y2", `${height}`);
          line.setAttribute("stroke", "rgba(255, 99, 71, 0.9)");
          line.setAttribute("stroke-width", "1.5");
          line.setAttribute("stroke-dasharray", "6 5");
          bandSvg.appendChild(line);
        }
      }
    };

    const redraw = () => window.requestAnimationFrame(drawForecastBand);
    const resizeObserver = new ResizeObserver(redraw);
    resizeObserver.observe(container);
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
    redraw();

    return () => {
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleTimeRangeChange(redraw);
      chart.remove();
      bandSvg.remove();
    };
  }, [history, prediction, samplePaths, actual, focusTimestamp]);

  return <div className="chart-surface" ref={containerRef} />;
}
