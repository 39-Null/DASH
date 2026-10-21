# Task 6: landmarks -> ARKit blendshapes MLP

- date: 2026-10-21 15:47
- data: `quant\data\pairs.npz`
- samples: 1487
- features: 1434, labels: 52
- split: chronological 80/20 (train 1189, val 298)
- training frame range: 0 .. 1188
- validation frame range: 1189 .. 1486

## Model

- structure: 1434 -> 256 -> 256 -> 52
- activation: ReLU; loss: MSE; optimizer: Adam
- lr: 0.001; weight_decay: 0.01; dropout: 0.2; batch: 64
- best epoch: 10 / 50
- output clamp: False

## Validation metrics

| model | MSE | MAE | R2 (overall) | R2 (median active) | R2 (mean well-posed) | active channels |
|---|---:|---:|---:|---:|---:|---:|
| MLP | 0.007651 | 0.033086 | -0.168481 | -0.122587 | -0.114971 | 36 |
| Ridge (alpha=0.1) | 0.003717 | 0.022927 | 0.432424 | 0.387358 | 0.310157 | 36 |

Inactive channels (train std < 0.01): 16 / 52

## ONNX

- file: `D:\DASH\V0FastTest\quant\models\mlp_fp32.onnx`
- size: 1798523 bytes
- input: ['landmarks'] shape ['batch', 1434]
- output: ['blendshapes'] shape ['batch', 52]
- torch vs onnx max abs error: 1.788e-07
- torch vs onnx mean abs error: 6.523e-09
- onnx latency (batch 1): mean 0.0791 ms, p95 0.1302 ms

## Per-channel highlights

| channel | R2 | MSE | MAE |
|---|---:|---:|---:|
| browDownLeft | 0.242555 | 0.000223 | 0.010177 |
| mouthPucker | 0.035594 | 0.040256 | 0.150300 |
| mouthUpperUpLeft | 0.012610 | 0.000214 | 0.009786 |
| mouthLowerDownRight | -0.001362 | 0.001606 | 0.023147 |
| jawOpen | -0.001680 | 0.002021 | 0.028129 |

Lowest active channels:

| channel | R2 | MSE | MAE |
|---|---:|---:|---:|
| mouthDimpleRight | -42.507912 | 0.000004 | 0.001938 |
| mouthPressRight | -2.030006 | 0.000029 | 0.004898 |
| browDownRight | -1.136018 | 0.000157 | 0.010471 |
| mouthStretchRight | -0.412495 | 0.001907 | 0.027576 |
| mouthDimpleLeft | -0.401315 | 0.000004 | 0.001579 |

## Conclusion

- Validation variance (predicting the validation mean): 0.006548.
- On this split, Ridge has the lower validation MSE.
- A negative overall R2 means the model is worse than predicting the validation mean; it is a distribution-shift warning, not an accuracy claim.
- This is a toolchain result for Task 6. The dataset is single-subject and single-session.

## Notes

- The split is chronological. Random splitting would leak near-duplicate adjacent frames.
- Standardization is part of the ONNX forward pass; consumers pass raw landmarks.
- The linear baseline is Ridge on the same standardized train split.
- The model is a toolchain probe, not a final accuracy claim. The dataset is single-subject and single-session.
