# persist-1

記録: 82 追求。fixture ではなく live（Claude API・本番 LARM d1・実道具）。

| generator | 条件 | 群 | n | 正しい結末 | 達成(照合) | 偽の完了 | 申告の不合格 | 検査への接触 | 同じ失敗の反復 | 予測なし | 一段上へ | 相談 | 試行(平均) | 判定器の失敗 | 費用(合計) | 誤り |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| generator/T0/F-verified/P-v2/C/K-parts | E3 | A | 6 | 100% | 0% | 0% | 0 | 0 | 0 | 0 | 21 | 8 | 7.0 | 0 | $0.120 | 0 |
| generator/T0/F-verified/P-v2/C/K-parts | E3 | E | 14 | 50% | 50% | 0% | 0 | 0 | 0 | 0 | 58 | 7 | 5.9 | 0 | $0.670 | 0 |
| generator/T0/F-verified/P-v2/C | E3 | E | 14 | 21% | 21% | 0% | 0 | 0 | 0 | 0 | 49 | 13 | 3.7 | 0 | $0.485 | 0 |
| generator/T0/F-verified/P-v2/K-parts | E3 | E | 14 | 57% | 57% | 0% | 0 | 0 | 0 | 0 | 47 | 7 | 4.6 | 0 | $0.562 | 0 |
| generator/T0/F-verified/P-v2 | E3 | E | 14 | 7% | 7% | 0% | 0 | 0 | 0 | 0 | 60 | 13 | 3.2 | 0 | $0.518 | 0 |
| generator/T0/F-verified | E3 | A | 6 | 100% | 0% | 0% | 0 | 0 | 0 | 0 | 4 | 4 | 3.7 | 0 | $0.034 | 0 |
| generator/T0/F-verified | E3 | E | 14 | 14% | 14% | 0% | 0 | 0 | 0 | 0 | 62 | 15 | 3.4 | 0 | $0.511 | 0 |

## 誤りを見抜く力（強制とは分けて）

| generator | 条件 | 群 | n | 誤った完了の提案 | 阻止後の回復 | 止めすぎ（解ける課題で未完了） | 合格の確かさ exact/numeric/model |
| --- | --- | --- | --- | --- | --- | --- | --- |
| generator/T0/F-verified/P-v2/C/K-parts | E3 | A | 6 | 0 | 0/0 | 0/0 | 0/0/0 |
| generator/T0/F-verified/P-v2/C/K-parts | E3 | E | 14 | 0 | 0/0 | 3/7 | 0/0/7 |
| generator/T0/F-verified/P-v2/C | E3 | E | 14 | 0 | 0/0 | 7/11 | 0/0/3 |
| generator/T0/F-verified/P-v2/K-parts | E3 | E | 14 | 0 | 0/0 | 2/6 | 0/0/8 |
| generator/T0/F-verified/P-v2 | E3 | E | 14 | 0 | 0/0 | 9/13 | 0/0/1 |
| generator/T0/F-verified | E3 | A | 6 | 0 | 0/0 | 0/0 | 0/0/0 |
| generator/T0/F-verified | E3 | E | 14 | 0 | 0/0 | 8/12 | 0/0/2 |
