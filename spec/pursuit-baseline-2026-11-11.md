# 外部Evaluatorを使わない追求の比較

既存の `eval/main.ts` で、直接解法（D0）、振り返り付きの追求（E1R）、進展評価付きの追求（`productive`）を比較する。3条件とも既存課題とホストの受入検証を使う。進展の意味判断は既存のreviewerが行う。評価実行器は判断と道具を順次処理するため、非同期の待機や並行実行はEumenesエミュレータで検証する。

## 実行条件と再現

初回はgpt-6-lunaを生成と振り返りに使用。3課題×3条件×各1回、並行数1。仕入価格と出張予算の2題は情報不足を認めて終えること、共有キャッシュの調査は引用した観測が実験記録と一致することを採点する。共有キャッシュでの自由記述の品質と提案の最適性は採点対象外。

```sh
bun eval/main.ts run --name pursuit-baseline-20261111 --budget-id pursuit-baseline-20261111 \
  --conditions D0,E1R,productive \
  --tasks a-stale-supplier-price,a-missing-budget,hz12-study-cache \
  --concurrency 1 --repeat 1 --order-seed pursuit-baseline-20261111 \
  --policy config/policy.v5-tight.json --max-steps 80 --findings verified \
  --self-check parts --prediction falsifiable --verify-on claim \
  --completion-check acceptance --claim-feedback verdict --attempt-count mutating \
  --grader-llm none
bun eval/main.ts report --name pursuit-baseline-20261111
```

初回は既存の全体上限に加えて、この実行の費用を3 USDに制限した。新規に試行する場合は別の実行名を使う。実行計画、各条件の有効設定、費用と結果はローカルの `eval/results/pursuit-baseline-20261111/` に保存した。既存の `assertComparable` で、E1Rと `productive` の設定差が実行方式だけであること、D0とE1Rの差が方式固有の条件とreviewerの有無だけであることを確認した。

## 評価と再開に使う履歴

- **正当な待機** — エミュレータの `museum` 固定試験。1件目の資料が届いても2件目が未着であれば待機し、状態が変わるまで追加のモデル呼び出しをしない。実行イベントで道具の開始・到着とモデル呼び出しを照合する。
- **進展のない反復** — 11月9日の[一部取得不能の履歴](verification/partial-finalization-2026-11-09.md#停滞と待機)。変更前は停止理由だけの変化で同じ部分回答を2回再保存した。比較では成果物の内容と保存記録を照合する。
- **根拠を残した部分終了** — 同じ追試の「一部取得不能」と「取得上限」。確認済み資料を保存し、最終照合では出典が合格、回答の充足が不合格。ローカル保存済みの11月10日台帳でも、部分終了の判断と根拠の試行番号を確認した。

```sh
bun examples/eumenes/run.ts fixture productive museum artifacts/pursuit-baseline-20261111/fixture
bun eval/trace.ts --ledger artifacts/pursuit-baseline-20261111/fixture/museum/example.sqlite
bun test ./eval/test/runner-contract.test.ts ./test/scenario/process-recovery.test.ts ./test/scenario/eumenes-example.test.ts
```

`--ledger` は既存の台帳を読み取り専用で開く。進展判断の根拠に挙がった番号を実行済み試行に照合し、モデル判断とホスト検証の確かさを区別して読む。D0の行動記録は台帳ではなく、比較実行ディレクトリの `direct/` に保存される。

## 初回の結果

全予定9件を収録し、欠落、APIエラー、最終照合の未了、費用不明は0件。初回の実行ソースは `c71904795599d1c10fc70cb2b54831caa89133046eb2c3be5c87a37652c15ad9`。実行中はソースを編集していない。実行後に集計表の見出しを訂正し、同じ原記録から報告を再生成した。実行設定に保存したソースIDは実行時の値を保持する。

| 条件 | 期待する結末 | 道具呼出の合計 | モデル要求の合計 | 総時間 秒 | 総費用 USD |
| --- | ---: | ---: | ---: | ---: | ---: |
| D0 | 3/3 | 43 | 46 | 198.25 | 0.02480515 |
| E1R | 2/3 | 69 | 84 | 839.28 | 0.12347745 |
| productive | 3/3 | 21 | 21 | 216.55 | 0.016935805 |

2つの情報不足課題は、全条件で必要情報を推測して提出せず終了した。共有キャッシュの調査ではD0が33道具呼出・166.29秒・0.0217212 USD、productiveが14道具呼出・104.88秒・0.00701194 USDで報告を提出し、観測の照合を通過した。実験数や調査範囲は各方式に委ねているため、自由記述の品質や調査の網羅性が同等とする根拠には使わない。

E1Rの調査は60道具呼出・627.99秒で試行予算を使い切って停止した。停止時の報告はホストの照合に合格したが、自ら完了申告せず、期待するcompletedへ到達しなかったため不成功。原記録の `outcome=stopped`、`verified=true`、`correct=false` を保持する。途中でsubmit_reportを複数回使ってから実験を続けた履歴があり、報告の成立と終了判断を別々に分析できる。50道具呼出の観測条件には達したが、長時間にわたる進展の品質や再開の信頼性はこの単回で結論しない。

全9件のAPI使用量は151要求、0.165218405 USD。値は既存の計器と登録料金によるもので、請求書との照合値ではない。各条件1回の探索的比較であり、モデル・課題一般への優位性は未確定。

### 集計表の訂正

productiveの部分終了も既存台帳では `trigger=claim` の照合として保存される。従来の「誤った完了の提案」「申告の不合格」という見出しは、この部分終了の確認不合格を含んでいた。集計表を「完了・部分終了の照合不合格」と明記するよう訂正した。実行履歴、採点、集計値、既存JSONの `failedClaims` と `claims` のフィールド名は保持する。今回のproductiveの情報不足2件は部分終了を選択しており、誤った完了申告2件とは扱わない。

## 検証と次の作業

- 変更前の関連33試験に合格。追加したproductiveのCLI再開試験も合格し、同じ追求ID・会計scope、道具呼出1回、進展判断の根拠表示、台帳を変更しない読取りを確認した。
- 全体検証は597件合格、既存12件スキップ。型・lint・境界・成果物混入検査・永続SQLiteの性能検査に合格。
- 既存の `assertComparable` で条件差を点検し、実行の前後でソースIDの一致を確認した。確認表はローカルの `artifacts/pursuit-baseline-20261111/verified-baseline.tsv` に保存。
- 正当な待機と並行取得、確定済み道具の重複実行防止は固定試験で確認した。今回の実API比較は再開を挟まず実行した。
- 次は保存済みのE1R調査から、完了判断時に渡っていた報告・観測・残予算を確認する。改善候補を試すときは別の実行名と設定を固定し、今回の基準と新しい課題で比較する。外部Evaluatorの接続時には、この履歴を判断の点検材料にする。
