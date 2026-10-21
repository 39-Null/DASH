# Task 6: landmarks -> ARKit blendshapes MLP

- date: 2026-10-21 15:46
- data: `quant\data\pairs_s01.npz`
- samples: 5626
- features: 1434, labels: 52
- split: chronological 80/20 (train 4500, val 1126)
- training frame range: 0 .. 4630
- validation frame range: 4631 .. 5781

## Model

- structure: 1434 -> 256 -> 256 -> 52
- activation: ReLU; loss: MSE; optimizer: Adam
- lr: 0.001; weight_decay: 0.01; dropout: 0.2; batch: 64
- best epoch: 8 / 58
- output clamp: False

## Validation metrics

| model | MSE | MAE | R2 (overall) | R2 (median active) | R2 (mean well-posed) | active channels |
|---|---:|---:|---:|---:|---:|---:|
| MLP | 0.027150 | 0.081937 | -0.152520 | -0.108768 | -0.156955 | 41 |
| Ridge (alpha=0.1) | 0.047339 | 0.100186 | -1.009491 | -0.725485 | -1.151556 | 41 |

Inactive channels (train std < 0.01): 11 / 52

## ONNX

- file: `quant\models\mlp_fp32_s01.onnx`
- size: 1798523 bytes
- input: ['landmarks'] shape ['batch', 1434]
- output: ['blendshapes'] shape ['batch', 52]
- torch vs onnx max abs error: 8.941e-08
- torch vs onnx mean abs error: 6.315e-09
- onnx latency (batch 1): mean 0.0891 ms, p95 0.1121 ms

## Per-channel highlights

| channel | R2 | MSE | MAE |
|---|---:|---:|---:|
| browOuterUpLeft | 0.025992 | 0.033173 | 0.150506 |
| mouthRight | 0.016956 | 0.001712 | 0.021400 |
| eyeBlinkRight | 0.016047 | 0.034327 | 0.157659 |
| mouthDimpleRight | -0.000170 | 0.001316 | 0.015494 |
| mouthRollUpper | -0.001609 | 0.000355 | 0.009697 |

Lowest active channels:

| channel | R2 | MSE | MAE |
|---|---:|---:|---:|
| jawOpen | -1.590466 | 0.004600 | 0.063667 |
| browInnerUp | -0.874496 | 0.010916 | 0.095106 |
| browDownLeft | -0.347907 | 0.104295 | 0.186713 |
| mouthLowerDownRight | -0.341434 | 0.006110 | 0.063310 |
| browDownRight | -0.325013 | 0.032450 | 0.098578 |

## Conclusion

- Validation variance (predicting the validation mean): 0.023557.
- On this split, MLP has the lower validation MSE.
- A negative overall R2 means the model is worse than predicting the validation mean; it is a distribution-shift warning, not an accuracy claim.
- This is a toolchain result for Task 6. The dataset is single-subject and single-session.

## Notes

- The split is chronological. Random splitting would leak near-duplicate adjacent frames.
- Standardization is part of the ONNX forward pass; consumers pass raw landmarks.
- The linear baseline is Ridge on the same standardized train split.
- The model is a toolchain probe, not a final accuracy claim. The dataset is single-subject and single-session.
