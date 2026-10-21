import numpy as np
import torch

from quant.train_mlp import (
    ACTIVE_STD,
    StandardizedMLP,
    blendshape_names,
    load_pairs,
    regression_metrics,
    standardize,
    time_split_indices,
)


def test_time_split_is_chronological_and_disjoint():
    frame_index = np.array([50, 10, 40, 0, 30, 20], dtype=np.int64)
    train, val = time_split_indices(frame_index, val_ratio=1 / 3)

    assert len(train) == 4
    assert len(val) == 2
    assert set(train).isdisjoint(set(val))
    assert set(train) | set(val) == set(range(6))
    assert set(frame_index[train]) == {0, 10, 20, 30}
    assert set(frame_index[val]) == {40, 50}


def test_time_split_rejects_invalid_ratio():
    frame_index = np.arange(10)
    for ratio in (0.0, 1.0, -0.1, 1.1):
        try:
            time_split_indices(frame_index, ratio)
        except ValueError:
            pass
        else:
            raise AssertionError(f"ratio {ratio} should fail")


def test_standardize_uses_train_statistics():
    x_train = np.array([[1.0, 10.0], [3.0, 10.0]], dtype=np.float32)
    x_val = np.array([[5.0, 10.0]], dtype=np.float32)
    train_std, val_std, mean, std = standardize(x_train, x_val)

    assert np.allclose(mean, [2.0, 10.0])
    assert np.allclose(std, [1.0, 1e-6], atol=1e-6)
    assert np.allclose(train_std.mean(axis=0), [0.0, 0.0], atol=1e-6)
    assert np.allclose(val_std, [[3.0, 0.0]], atol=1e-5)


def test_regression_metrics_perfect_prediction():
    y = np.array([[0.0, 1.0], [1.0, 0.0]], dtype=np.float32)
    pred = y.copy()
    active = np.array([True, True])
    metrics = regression_metrics(y, pred, active)

    assert metrics["mse"] == 0.0
    assert metrics["mae"] == 0.0
    assert metrics["r2_overall"] == 1.0
    assert metrics["r2_mean_active"] == 1.0
    assert metrics["active_channels"] == 2
    assert metrics["inactive_channels"] == 0


def test_regression_metrics_marks_constant_channel_inactive():
    y = np.zeros((4, 2), dtype=np.float32)
    y[:, 0] = [0.0, 0.2, 0.4, 0.6]
    pred = y + 0.1
    active = y.std(axis=0) >= ACTIVE_STD
    metrics = regression_metrics(y, pred, active)

    assert metrics["active_channels"] == 1
    assert metrics["inactive_channels"] == 1
    assert np.isnan(metrics["r2_per_channel"][1])


def test_standardized_mlp_forward_and_buffers():
    mean = np.zeros(1434, dtype=np.float32)
    std = np.ones(1434, dtype=np.float32)
    model = StandardizedMLP(1434, 52, 32, mean, std, clamp_output=False)
    out = model(torch.zeros(2, 1434, dtype=torch.float32))
    assert out.shape == (2, 52)
    assert torch.allclose(model.x_mean, torch.zeros(1434))
    assert torch.allclose(model.x_std, torch.ones(1434))


def test_load_pairs_accepts_missing_frame_index(tmp_path):
    path = tmp_path / "pairs.npz"
    np.savez_compressed(
        path,
        features=np.zeros((10, 1434), dtype=np.float32),
        labels=np.zeros((10, 52), dtype=np.float32),
    )
    x, y, frame_index = load_pairs(path)
    assert x.shape == (10, 1434)
    assert y.shape == (10, 52)
    assert np.array_equal(frame_index, np.arange(10))


def test_blendshape_names_length():
    assert len(blendshape_names()) == 52
