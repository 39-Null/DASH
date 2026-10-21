"""Task 6: train a small landmark -> ARKit blendshape MLP and export ONNX.

Design decisions (locked in doc/HANDOFF.md):
- per-axis standardization is baked into the exported model;
- split is chronological, not random;
- weight decay is used;
- a regularized linear baseline is reported for comparison.

Output contract:
    input  "landmarks"   (B, 1434) float32
    output "blendshapes" (B, 52)   float32

Run:
    D:\\Miniconda3\\python.exe -m quant.train_mlp
    D:\\Miniconda3\\python.exe -m quant.train_mlp --data quant/data/pairs_s01.npz
"""

from __future__ import annotations

import argparse
import csv
import inspect
import json
import math
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from quant.bench import file_size_bytes, measure_latency

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "quant" / "data" / "pairs.npz"
DEFAULT_MODEL = ROOT / "quant" / "models" / "mlp_fp32.onnx"
DEFAULT_REPORT = ROOT / "quant" / "result" / "train_mlp.md"
DEFAULT_METRICS = ROOT / "quant" / "result" / "train_mlp_metrics.json"
DEFAULT_CHANNELS = ROOT / "quant" / "result" / "train_mlp_channels.csv"

INPUT_NAME = "landmarks"
OUTPUT_NAME = "blendshapes"
ACTIVE_STD = 0.01


def blendshape_names() -> list[str]:
    try:
        from showcase.backend.contract import BLENDSHAPE_NAMES

        return list(BLENDSHAPE_NAMES)
    except Exception:
        return [f"ch{i}" for i in range(52)]


def load_pairs(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    with np.load(path) as data:
        if "features" not in data.files or "labels" not in data.files:
            raise ValueError(f"{path} must contain features and labels")
        x = np.ascontiguousarray(data["features"], dtype=np.float32)
        y = np.ascontiguousarray(data["labels"], dtype=np.float32)
        if "frame_index" in data.files:
            frame_index = np.asarray(data["frame_index"], dtype=np.int64)
        else:
            frame_index = np.arange(len(x), dtype=np.int64)

    if x.ndim != 2 or x.shape[1] != 1434:
        raise ValueError(f"features must be (N, 1434), got {x.shape}")
    if y.ndim != 2 or y.shape[1] != 52:
        raise ValueError(f"labels must be (N, 52), got {y.shape}")
    if len(x) != len(y) or len(x) != len(frame_index):
        raise ValueError("features, labels and frame_index must have the same length")
    if len(x) < 10:
        raise ValueError(f"need at least 10 samples, got {len(x)}")

    return x, y, frame_index


def time_split_indices(frame_index: np.ndarray, val_ratio: float) -> tuple[np.ndarray, np.ndarray]:
    """Return chronological train/val indices.

    The split point is chosen on sorted frame_index, not on random samples.
    This prevents near-duplicate adjacent frames from leaking across the split.
    """
    if not 0 < val_ratio < 1:
        raise ValueError("val_ratio must be between 0 and 1")
    order = np.argsort(frame_index, kind="stable")
    split = int(len(order) * (1.0 - val_ratio))
    split = max(1, min(len(order) - 1, split))
    return order[:split], order[split:]


def standardize(
    x_train: np.ndarray, x_val: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    mean = x_train.mean(axis=0).astype(np.float32)
    std = x_train.std(axis=0).astype(np.float32)
    std = np.maximum(std, 1e-6)
    x_train_std = ((x_train - mean) / std).astype(np.float32)
    x_val_std = ((x_val - mean) / std).astype(np.float32)
    return x_train_std, x_val_std, mean, std


class StandardizedMLP(nn.Module):
    """MLP with fixed per-axis normalization buffers.

    Normalization is part of forward(), so ONNX consumers can pass raw
    landmarks and do not need to reproduce the training-time mean/std.
    """

    def __init__(
        self,
        in_dim: int,
        out_dim: int,
        hidden: int,
        mean: np.ndarray,
        std: np.ndarray,
        clamp_output: bool = False,
        dropout: float = 0.0,
    ) -> None:
        super().__init__()
        self.register_buffer("x_mean", torch.as_tensor(mean, dtype=torch.float32))
        self.register_buffer("x_std", torch.as_tensor(std, dtype=torch.float32))
        self.clamp_output = clamp_output
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Dropout(dropout) if dropout > 0 else nn.Identity(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Dropout(dropout) if dropout > 0 else nn.Identity(),
            nn.Linear(hidden, out_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        z = (x - self.x_mean) / self.x_std
        out = self.net(z)
        if self.clamp_output:
            out = torch.clamp(out, 0.0, 1.0)
        return out


def regression_metrics(
    y_true: np.ndarray, y_pred: np.ndarray, active_mask: np.ndarray
) -> dict:
    err = y_pred - y_true
    mse = float(np.mean(err * err))
    mae = float(np.mean(np.abs(err)))

    ss_res = np.sum(err * err, axis=0)
    y_mean = y_true.mean(axis=0)
    ss_tot = np.sum((y_true - y_mean) ** 2, axis=0)
    r2 = np.full(ss_res.shape, np.nan, dtype=np.float64)
    defined = ss_tot > 1e-12
    r2[defined] = 1.0 - ss_res[defined] / ss_tot[defined]

    denom = float(np.sum(ss_tot))
    r2_overall = float(1.0 - np.sum(ss_res) / denom) if denom > 1e-12 else float("nan")

    active_r2 = r2[active_mask]
    well_posed = y_true.std(axis=0) >= 0.05
    well_posed_r2 = r2[well_posed]
    return {
        "mse": mse,
        "mae": mae,
        "r2_overall": r2_overall,
        "r2_mean_active": float(np.nanmean(active_r2)) if len(active_r2) else float("nan"),
        "r2_median_active": float(np.nanmedian(active_r2)) if len(active_r2) else float("nan"),
        "r2_mean_well_posed": float(np.nanmean(well_posed_r2)) if len(well_posed_r2) else float("nan"),
        "active_channels": int(active_mask.sum()),
        "inactive_channels": int(len(active_mask) - active_mask.sum()),
        "well_posed_channels": int(well_posed.sum()),
        "r2_per_channel": r2,
    }


def per_channel_rows(
    names: list[str],
    y_train: np.ndarray,
    y_true: np.ndarray,
    y_pred: np.ndarray,
    active_mask: np.ndarray,
) -> list[dict]:
    err = y_pred - y_true
    mse = np.mean(err * err, axis=0)
    mae = np.mean(np.abs(err), axis=0)
    ss_res = np.sum(err * err, axis=0)
    ss_tot = np.sum((y_true - y_true.mean(axis=0)) ** 2, axis=0)
    r2 = np.where(ss_tot > 1e-12, 1.0 - ss_res / ss_tot, np.nan)
    std = y_train.std(axis=0)
    well_posed = y_true.std(axis=0) >= 0.05

    rows = []
    for i, name in enumerate(names):
        rows.append(
            {
                "channel": name,
                "train_std": float(std[i]),
                "active": bool(active_mask[i]),
                "well_posed": bool(well_posed[i]),
                "r2": float(r2[i]) if np.isfinite(r2[i]) else None,
                "mse": float(mse[i]),
                "mae": float(mae[i]),
            }
        )
    return rows


def train_mlp(
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_val: np.ndarray,
    y_val: np.ndarray,
    mean: np.ndarray,
    std: np.ndarray,
    args: argparse.Namespace,
) -> tuple[StandardizedMLP, dict]:
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    dataset = TensorDataset(
        torch.from_numpy(np.ascontiguousarray(x_train)),
        torch.from_numpy(np.ascontiguousarray(y_train)),
    )
    loader = DataLoader(
        dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=0,
        drop_last=False,
    )

    model = StandardizedMLP(
        in_dim=x_train.shape[1],
        out_dim=y_train.shape[1],
        hidden=args.hidden,
        mean=mean,
        std=std,
        clamp_output=args.clamp,
        dropout=args.dropout,
    )
    loss_fn = nn.MSELoss()
    optimizer = torch.optim.Adam(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay
    )
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="min", factor=0.5, patience=15, min_lr=1e-5
    )

    x_val_t = torch.from_numpy(np.ascontiguousarray(x_val))
    best_loss = float("inf")
    best_epoch = 0
    best_state = None
    history = []
    stale = 0

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        total_n = 0
        for xb, yb in loader:
            optimizer.zero_grad()
            pred = model(xb)
            loss = loss_fn(pred, yb)
            loss.backward()
            optimizer.step()
            total_loss += float(loss.item()) * len(xb)
            total_n += len(xb)

        train_loss = total_loss / max(1, total_n)
        model.eval()
        with torch.no_grad():
            val_pred = model(x_val_t).cpu().numpy()
        val_loss = float(np.mean((val_pred - y_val) ** 2))
        scheduler.step(val_loss)

        history.append((epoch, train_loss, val_loss))
        if val_loss < best_loss:
            best_loss = val_loss
            best_epoch = epoch
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
            stale = 0
        else:
            stale += 1

        if epoch == 1 or epoch % args.log_every == 0:
            lr = optimizer.param_groups[0]["lr"]
            print(
                f"epoch {epoch:4d} train_mse={train_loss:.6f} "
                f"val_mse={val_loss:.6f} lr={lr:.2e}"
            )

        if stale >= args.patience:
            print(f"early stop at epoch {epoch}, best epoch {best_epoch}")
            break

    if best_state is None:
        raise RuntimeError("training did not produce a checkpoint")
    model.load_state_dict(best_state)
    model.eval()
    return model, {
        "best_epoch": best_epoch,
        "best_val_mse": best_loss,
        "epochs_run": len(history),
        "history": history,
    }


def export_onnx(model: StandardizedMLP, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros(1, 1434, dtype=torch.float32)
    kwargs = {
        "input_names": [INPUT_NAME],
        "output_names": [OUTPUT_NAME],
        "opset_version": 17,
        "do_constant_folding": True,
        "dynamic_axes": {
            INPUT_NAME: {0: "batch"},
            OUTPUT_NAME: {0: "batch"},
        },
    }
    if "dynamo" in inspect.signature(torch.onnx.export).parameters:
        kwargs["dynamo"] = False
    torch.onnx.export(model, dummy, str(path), **kwargs)


def verify_onnx(model: StandardizedMLP, path: Path, x_val: np.ndarray) -> dict:
    import onnxruntime as ort

    batch = np.ascontiguousarray(x_val[: min(32, len(x_val))])
    with torch.no_grad():
        torch_out = model(torch.from_numpy(batch)).cpu().numpy()

    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    onnx_out = session.run(None, {INPUT_NAME: batch})[0]

    error = np.abs(torch_out - onnx_out)
    latency = measure_latency(
        lambda: session.run(None, {INPUT_NAME: np.ascontiguousarray(x_val[:1])})[0],
        n_warmup=10,
        n_runs=100,
    )
    return {
        "path": str(path),
        "input_names": [i.name for i in session.get_inputs()],
        "output_names": [o.name for o in session.get_outputs()],
        "input_shape": list(session.get_inputs()[0].shape),
        "output_shape": list(session.get_outputs()[0].shape),
        "max_abs_error": float(error.max()),
        "mean_abs_error": float(error.mean()),
        "latency": {key: float(value) for key, value in latency.items()},
        "size_bytes": file_size_bytes(path),
    }


def fit_linear_baseline(
    x_train: np.ndarray,
    y_train: np.ndarray,
    x_val: np.ndarray,
    y_val: np.ndarray,
    alpha: float,
    clamp_output: bool,
) -> tuple[np.ndarray, dict]:
    from sklearn.linear_model import Ridge

    model = Ridge(alpha=alpha, fit_intercept=True, solver="lsqr")
    model.fit(x_train, y_train)
    pred = model.predict(x_val).astype(np.float32)
    if clamp_output:
        pred = np.clip(pred, 0.0, 1.0)
    return pred, {"alpha": alpha}


def write_report(
    path: Path,
    data_path: Path,
    names: list[str],
    x: np.ndarray,
    y: np.ndarray,
    frame_index: np.ndarray,
    train_idx: np.ndarray,
    val_idx: np.ndarray,
    args: argparse.Namespace,
    train_info: dict,
    mlp_metrics: dict,
    linear_metrics: dict,
    linear_info: dict,
    onnx_info: dict,
    channel_rows: list[dict],
) -> None:
    active_rows = [row for row in channel_rows if row["active"] and row["r2"] is not None]
    active_rows.sort(key=lambda row: row["r2"], reverse=True)
    top = active_rows[:5]
    bottom = active_rows[-5:][::-1] if active_rows else []

    def fmt(value: float) -> str:
        return "nan" if not math.isfinite(value) else f"{value:.6f}"

    lines = [
        "# Task 6: landmarks -> ARKit blendshapes MLP",
        "",
        f"- date: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"- data: `{data_path}`",
        f"- samples: {len(x)}",
        f"- features: {x.shape[1]}, labels: {y.shape[1]}",
        f"- split: chronological 80/20 (train {len(train_idx)}, val {len(val_idx)})",
        f"- training frame range: {int(frame_index[train_idx].min())} .. {int(frame_index[train_idx].max())}",
        f"- validation frame range: {int(frame_index[val_idx].min())} .. {int(frame_index[val_idx].max())}",
        "",
        "## Model",
        "",
        f"- structure: {x.shape[1]} -> {args.hidden} -> {args.hidden} -> {y.shape[1]}",
        f"- activation: ReLU; loss: MSE; optimizer: Adam",
        f"- lr: {args.lr}; weight_decay: {args.weight_decay}; dropout: {args.dropout}; batch: {args.batch_size}",
        f"- best epoch: {train_info['best_epoch']} / {train_info['epochs_run']}",
        f"- output clamp: {args.clamp}",
        "",
        "## Validation metrics",
        "",
        "| model | MSE | MAE | R2 (overall) | R2 (median active) | R2 (mean well-posed) | active channels |",
        "|---|---:|---:|---:|---:|---:|---:|",
        f"| MLP | {fmt(mlp_metrics['mse'])} | {fmt(mlp_metrics['mae'])} | "
        f"{fmt(mlp_metrics['r2_overall'])} | {fmt(mlp_metrics['r2_median_active'])} | "
        f"{fmt(mlp_metrics['r2_mean_well_posed'])} | {mlp_metrics['active_channels']} |",
        f"| Ridge (alpha={linear_info['alpha']}) | {fmt(linear_metrics['mse'])} | "
        f"{fmt(linear_metrics['mae'])} | {fmt(linear_metrics['r2_overall'])} | "
        f"{fmt(linear_metrics['r2_median_active'])} | "
        f"{fmt(linear_metrics['r2_mean_well_posed'])} | {linear_metrics['active_channels']} |",
        "",
        f"Inactive channels (train std < {ACTIVE_STD}): {mlp_metrics['inactive_channels']} / {len(names)}",
        "",
        "## ONNX",
        "",
        f"- file: `{onnx_info['path']}`",
        f"- size: {onnx_info['size_bytes']} bytes",
        f"- input: {onnx_info['input_names']} shape {onnx_info['input_shape']}",
        f"- output: {onnx_info['output_names']} shape {onnx_info['output_shape']}",
        f"- torch vs onnx max abs error: {onnx_info['max_abs_error']:.3e}",
        f"- torch vs onnx mean abs error: {onnx_info['mean_abs_error']:.3e}",
        f"- onnx latency (batch 1): mean {onnx_info['latency']['mean_ms']:.4f} ms, "
        f"p95 {onnx_info['latency']['p95_ms']:.4f} ms",
        "",
        "## Per-channel highlights",
        "",
        "| channel | R2 | MSE | MAE |",
        "|---|---:|---:|---:|",
    ]
    for row in top:
        lines.append(
            f"| {row['channel']} | {fmt(row['r2'])} | {fmt(row['mse'])} | {fmt(row['mae'])} |"
        )
    if bottom:
        lines.append("")
        lines.append("Lowest active channels:")
        lines.append("")
        lines.append("| channel | R2 | MSE | MAE |")
        lines.append("|---|---:|---:|---:|")
        for row in bottom:
            lines.append(
                f"| {row['channel']} | {fmt(row['r2'])} | {fmt(row['mse'])} | {fmt(row['mae'])} |"
            )

    val_variance = float(np.mean((y[val_idx] - y[val_idx].mean(axis=0)) ** 2))
    if mlp_metrics["mse"] < linear_metrics["mse"]:
        better = "MLP"
    else:
        better = "Ridge"
    lines += [
        "",
        "## Conclusion",
        "",
        f"- Validation variance (predicting the validation mean): {val_variance:.6f}.",
        f"- On this split, {better} has the lower validation MSE.",
        "- A negative overall R2 means the model is worse than predicting the validation mean; "
        "it is a distribution-shift warning, not an accuracy claim.",
        "- This is a toolchain result for Task 6. The dataset is single-subject and single-session.",
        "",
        "## Notes",
        "",
        "- The split is chronological. Random splitting would leak near-duplicate adjacent frames.",
        "- Standardization is part of the ONNX forward pass; consumers pass raw landmarks.",
        "- The linear baseline is Ridge on the same standardized train split.",
        "- The model is a toolchain probe, not a final accuracy claim. The dataset is single-subject and single-session.",
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--out", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--metrics-json", type=Path, default=DEFAULT_METRICS)
    parser.add_argument("--channels-csv", type=Path, default=DEFAULT_CHANNELS)
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--epochs", type=int, default=300)
    parser.add_argument("--patience", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--hidden", type=int, default=256)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-2)
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--linear-alpha", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--log-every", type=int, default=20)
    parser.add_argument("--clamp", action="store_true")
    args = parser.parse_args()

    started = time.perf_counter()
    x, y, frame_index = load_pairs(args.data)
    train_idx, val_idx = time_split_indices(frame_index, args.val_ratio)

    x_train, y_train = x[train_idx], y[train_idx]
    x_val, y_val = x[val_idx], y[val_idx]

    x_train_std, x_val_std, mean, std = standardize(x_train, x_val)
    active_mask = y_train.std(axis=0) >= ACTIVE_STD

    print(
        f"data={args.data} samples={len(x)} train={len(train_idx)} val={len(val_idx)} "
        f"active={int(active_mask.sum())}/{len(active_mask)}"
    )

    model, train_info = train_mlp(
        x_train, y_train, x_val, y_val, mean, std, args
    )

    with torch.no_grad():
        mlp_pred = model(torch.from_numpy(np.ascontiguousarray(x_val))).cpu().numpy()
    mlp_metrics = regression_metrics(y_val, mlp_pred, active_mask)

    linear_pred, linear_info = fit_linear_baseline(
        x_train_std,
        y_train,
        x_val_std,
        y_val,
        alpha=args.linear_alpha,
        clamp_output=args.clamp,
    )
    linear_metrics = regression_metrics(y_val, linear_pred, active_mask)

    export_onnx(model, args.out)
    onnx_info = verify_onnx(model, args.out, x_val)

    names = blendshape_names()
    rows = per_channel_rows(names, y_train, y_val, mlp_pred, active_mask)
    args.channels_csv.parent.mkdir(parents=True, exist_ok=True)
    with args.channels_csv.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    val_variance = float(np.mean((y_val - y_val.mean(axis=0)) ** 2))
    metrics = {
        "task": "task6_mlp",
        "date": datetime.now().isoformat(timespec="seconds"),
        "data": str(args.data),
        "samples": len(x),
        "train_samples": len(train_idx),
        "val_samples": len(val_idx),
        "active_channels": int(active_mask.sum()),
        "inactive_channels": int(len(active_mask) - active_mask.sum()),
        "val_variance": val_variance,
        "mlp": {k: v for k, v in mlp_metrics.items() if k != "r2_per_channel"},
        "linear": {k: v for k, v in linear_metrics.items() if k != "r2_per_channel"},
        "linear_alpha": args.linear_alpha,
        "train": {k: v for k, v in train_info.items() if k != "history"},
        "onnx": onnx_info,
        "elapsed_sec": time.perf_counter() - started,
    }
    args.metrics_json.parent.mkdir(parents=True, exist_ok=True)
    args.metrics_json.write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    write_report(
        args.report,
        args.data,
        names,
        x,
        y,
        frame_index,
        train_idx,
        val_idx,
        args,
        train_info,
        mlp_metrics,
        linear_metrics,
        linear_info,
        onnx_info,
        rows,
    )

    print(
        f"MLP val MSE={mlp_metrics['mse']:.6f} "
        f"R2_median={mlp_metrics['r2_median_active']:.6f} | "
        f"Ridge MSE={linear_metrics['mse']:.6f} "
        f"R2_median={linear_metrics['r2_median_active']:.6f}"
    )
    print(
        f"ONNX max_abs_error={onnx_info['max_abs_error']:.3e} "
        f"size={onnx_info['size_bytes']} bytes "
        f"latency_mean={onnx_info['latency']['mean_ms']:.4f} ms"
    )
    print(f"report={args.report}")
    print(f"metrics={args.metrics_json}")
    print(f"channels={args.channels_csv}")
    print(f"elapsed={time.perf_counter() - started:.1f}s")


if __name__ == "__main__":
    main()
