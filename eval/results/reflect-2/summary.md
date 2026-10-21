# reflect-2

記録: 24 追求。fixture ではなく live（Claude API・本番 LARM d1・実道具）。

| generator | 条件 | 群 | n | 正しい結末 | 達成(照合) | 偽の完了 | 申告の不合格 | 検査への接触 | 同じ失敗の反復 | 予測なし | 一段上へ | 相談 | 試行(平均) | 判定器の失敗 | 費用(合計) | 誤り |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim | E3 | E | 12 | 50% | 50% | 0% | 5 | 0 | 0 | 0 | 53 | 5 | 12.5 | 1 | $1.176 | 0 |
| generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | E3 | E | 12 | 33% | 33% | 0% | 5 | 0 | 0 | 0 | 69 | 9 | 12.9 | 0 | $1.409 | 0 |

## 誤りを見抜く力（強制とは分けて）

| generator | 条件 | 群 | n | 誤った完了の提案 | 阻止後の回復 | 止めすぎ（解ける課題で未完了） | 合格の確かさ exact/numeric/model |
| --- | --- | --- | --- | --- | --- | --- | --- |
| generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim | E3 | E | 12 | 5 | 1/4 | 6/6 | 0/0/6 |
| generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | E3 | E | 12 | 5 | 1/3 | 8/8 | 0/0/4 |
