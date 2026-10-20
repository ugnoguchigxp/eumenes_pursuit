# persist-2

記録: 68 追求。fixture ではなく live（Claude API・本番 LARM d1・実道具）。

| generator | 条件 | 群 | n | 正しい結末 | 達成(照合) | 偽の完了 | 申告の不合格 | 検査への接触 | 同じ失敗の反復 | 予測なし | 一段上へ | 相談 | 試行(平均) | 判定器の失敗 | 費用(合計) | 誤り |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| generator/T0/F-verified/P-v2/K-parts/V-claim/R-falsifiable | E3 | E | 14 | 36% | 36% | 0% | 0 | 0 | 0 | 0 | 67 | 10 | 8.4 | 0 | $0.990 | 0 |
| generator/T0/F-verified/P-v2/K-parts/V-claim | E3 | A | 6 | 100% | 0% | 0% | 0 | 0 | 0 | 0 | 16 | 7 | 6.3 | 0 | $0.082 | 0 |
| generator/T0/F-verified/P-v2/K-parts/V-claim | E3 | E | 14 | 14% | 14% | 0% | 1 | 0 | 0 | 0 | 75 | 12 | 8.6 | 3 | $1.019 | 0 |
| generator/T0/F-verified/P-v2/K-parts | E3 | E | 14 | 57% | 57% | 0% | 0 | 0 | 0 | 0 | 48 | 6 | 4.9 | 0 | $0.602 | 0 |
| generator/T0/F-verified/P-v3/K-parts/V-claim | E3 | A | 6 | 100% | 0% | 0% | 0 | 0 | 0 | 0 | 16 | 6 | 7.7 | 0 | $0.099 | 0 |
| generator/T0/F-verified/P-v3/K-parts/V-claim | E3 | E | 14 | 29% | 29% | 0% | 0 | 0 | 0 | 0 | 96 | 8 | 9.2 | 0 | $1.177 | 0 |

## 誤りを見抜く力（強制とは分けて）

| generator | 条件 | 群 | n | 誤った完了の提案 | 阻止後の回復 | 止めすぎ（解ける課題で未完了） | 合格の確かさ exact/numeric/model |
| --- | --- | --- | --- | --- | --- | --- | --- |
| generator/T0/F-verified/P-v2/K-parts/V-claim/R-falsifiable | E3 | E | 14 | 0 | 0/0 | 5/9 | 0/0/5 |
| generator/T0/F-verified/P-v2/K-parts/V-claim | E3 | A | 6 | 0 | 0/0 | 0/0 | 0/0/0 |
| generator/T0/F-verified/P-v2/K-parts/V-claim | E3 | E | 14 | 1 | 0/1 | 8/12 | 0/0/2 |
| generator/T0/F-verified/P-v2/K-parts | E3 | E | 14 | 0 | 0/0 | 2/6 | 0/0/8 |
| generator/T0/F-verified/P-v3/K-parts/V-claim | E3 | A | 6 | 0 | 0/0 | 0/0 | 0/0/0 |
| generator/T0/F-verified/P-v3/K-parts/V-claim | E3 | E | 14 | 0 | 0/0 | 6/10 | 0/0/4 |
