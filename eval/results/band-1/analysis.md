# 失敗の傾向: band-1

| 課題 | 段階 | 条件 | 結末 | 最後に落ちた基準 | 申告の不合格 | 拒否 | 一段上へ | 道具 | 費用 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h4-bertrand | T0 | E3 | verified | - | 1 | claim_not_verified×1 invalid_proposal×2 | 1 | write_proof×6 check_tex×1 read_proof×3 | $0.062 |
| h4-bertrand | T0 | E3 | verified | - | 2 | invalid_proposal×3 claim_not_verified×2 | 4 | write_proof×11 check_tex×3 read_proof×8 | $0.150 |
| h4-bertrand | T0 | E3 | verified | - | 1 | invalid_proposal×2 claim_not_verified×1 reread_required×1 | 3 | write_proof×9 check_tex×3 read_proof×7 | $0.123 |
| h4-ln2-irrational | T0 | E3 | forced_stop | proof-sound | 0 | reread_required×1 | 1 | write_proof×1 read_proof×1 | $0.017 |
| h4-ln2-irrational | T0 | E3 | verified | - | 0 | reread_required×1 | 3 | write_proof×2 check_tex×2 read_proof×2 | $0.049 |
| h4-ln2-irrational | T0 | E3 | gave_up | proof-sound | 0 | reread_required×2 strategy_not_exhausted×7 | 8 | read_proof×6(err2) write_proof×4 check_tex×1 | $0.140 |

## 結末の分類
- verified: 4
- forced_stop: 1
- gave_up: 1

## 最後に落ちた基準
- proof-sound: 2

## 深さと部分点
| 課題 | 条件 | 構成 | n | 照合を通過 | 95% 区間 | 部分点 | 証明を書いた回数 | 方針の数 | 方針1 での試行 | 断念 / 停止 | 申告（通過 / 全体） | 申告漏れ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h4-bertrand | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 3 | 3 | 44–100% | 1.00 | 8.67 | 1.67 | 15.67 | 0 / 0 | 3 / 7 | 0 |
| h4-ln2-irrational | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 3 | 1 | 6–79% | 0.60 | 2.33 | 2.00 | 2.33 | 1 / 0 | 1 / 1 | 0 |
