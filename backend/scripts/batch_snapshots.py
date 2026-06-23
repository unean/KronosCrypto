"""批量生成预测快照并立即评估。

一次性拉取一段连续 K 线，在内存中滑动窗口生成多个锚点：
每个锚点用前 lookback 根做历史、后 pred_len 根做实际值，全程离线计算，
只需一次网络请求。后续多标的 RankIC 评估也可复用本脚本。

用法：
    python scripts/batch_snapshots.py --symbol ETH/USDT --timeframe 4h \
        --anchors 15 --step 8 --sample-count 4
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.proxy import apply_system_proxy
from app.core.database import SessionLocal
from app.services.market_data import MarketDataService
from app.services.prediction import PredictionService
from app.services.snapshots import SnapshotService


DEFAULT_PRED_LEN = {"15m": 48, "1h": 36, "4h": 21, "1d": 15}


def main() -> None:
    parser = argparse.ArgumentParser(description="批量生成并评估预测快照")
    parser.add_argument("--symbol", default="ETH/USDT")
    parser.add_argument("--timeframe", default="4h", choices=["15m", "1h", "4h", "1d"])
    parser.add_argument("--exchange", default="binance")
    parser.add_argument("--model-key", default="kronos-base")
    parser.add_argument("--device", default="mps")
    parser.add_argument("--lookback", type=int, default=400)
    parser.add_argument("--pred-len", type=int, default=0, help="0 表示按周期取默认值")
    parser.add_argument("--sample-count", type=int, default=4)
    parser.add_argument("--anchors", type=int, default=15, help="生成多少个锚点")
    parser.add_argument("--step", type=int, default=8, help="相邻锚点间隔多少根 K 线")
    args = parser.parse_args()

    pred_len = args.pred_len or DEFAULT_PRED_LEN[args.timeframe]
    apply_system_proxy()
    # 需要的总根数：最早锚点的 lookback + 跨越所有锚点 + 最后锚点的预测窗口 + 余量。
    span = (args.anchors - 1) * args.step
    needed = args.lookback + span + pred_len + 5

    print(f"拉取 {args.symbol} {args.timeframe} 约 {needed} 根 K 线 ...", flush=True)
    market = MarketDataService(args.exchange)
    candles = market.fetch_closed_ohlcv(args.symbol, args.timeframe, needed)
    print(f"实际取得 {len(candles)} 根。", flush=True)

    max_anchor_start = len(candles) - pred_len
    if args.lookback >= max_anchor_start:
        raise SystemExit("K 线不足以生成任何锚点，减小 lookback/anchors/step 或换更长历史。")

    prediction = PredictionService()
    snapshots = SnapshotService()
    db = SessionLocal()
    created = 0
    try:
        for i in range(args.anchors):
            anchor_idx = args.lookback + i * args.step
            if anchor_idx >= max_anchor_start:
                print(f"锚点 {i} 越界，提前结束。", flush=True)
                break

            history = candles[anchor_idx - args.lookback : anchor_idx]
            actual = candles[anchor_idx : anchor_idx + pred_len]

            result = prediction.predict(
                candles=history,
                timeframe=args.timeframe,
                lookback=len(history),
                pred_len=pred_len,
                model_key=args.model_key,
                device=args.device,
                temperature=1.0,
                top_p=0.9,
                sample_count=args.sample_count,
            )
            snapshot = snapshots.create_snapshot(
                db=db,
                symbol=args.symbol,
                timeframe=args.timeframe,
                exchange=args.exchange,
                model_key=args.model_key,
                device=args.device,
                lookback=len(history),
                pred_len=pred_len,
                history=history,
                prediction=result.prediction,
                sample_paths=result.sample_paths,
            )
            _, metrics = snapshots.evaluate(db, snapshot.id, actual)
            created += 1
            print(
                f"[{created}] 快照 #{snapshot.id} 锚点 {history[-1].timestamp} "
                f"方向 {metrics['direction_accuracy']:.1f}% "
                f"波动R²料 pred {metrics['pred_volatility_pct']:.3f}/act {metrics['actual_volatility_pct']:.3f}",
                flush=True,
            )
    finally:
        db.close()

    print(f"完成：新建并评估 {created} 个快照。", flush=True)


if __name__ == "__main__":
    main()
