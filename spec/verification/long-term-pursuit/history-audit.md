# 第1段階 Solverの履歴点検表

2026-11-11 · [長期開発計画](../../long-term-pursuit-plan.md)

## 保存済みの比較基準

実行名は `pursuit-baseline-20261111`。ソースIDは `c71904795599d1c10fc70cb2b54831caa89133046eb2c3be5c87a37652c15ad9`。生成と、使う方式での振り返りは OpenAI `gpt-6-luna`、推論強度 `medium`。外部Evaluatorは使っていない。3課題を各方式1回、並行数1で実行した。共通の設定値は `policy.v5-tight`、試行上限60、CLI手順上限80、時間上限45分、実行全体の費用上限3 USD。道具呼出数は各方式の記録から取り、CLI手順数とは区別した。 [実行条件と再現手順](../../pursuit-baseline-2026-11-11.md) · [有効設定](../../../eval/results/pursuit-baseline-20261111/configs)

| 方式 | 期待する結末に合致 | ホスト照合に合格 | 道具呼出 | モデル要求 | 経過秒の合計 | 費用 USD |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| D0 | 3/3 | 1/3 | 43 | 46 | 198.250 | 0.02480515 |
| E1R | 2/3 | 1/3 | 69 | 84 | 839.281 | 0.12347745 |
| `productive` | 3/3 | 1/3 | 21 | 21 | 216.552 | 0.016935805 |

元データは `runs.jsonl` 1〜9行。情報不足の2題（仕入価格と出張予算）は、各方式で根拠不足を残して終えるのが期待結果であり、照合合格は要求されない。共有キャッシュ調査では全方式の最終成果が観測の照合に合格した。D0は直接実行ログ34行で合格を確認できる。E1Rは報告が合格しても完了申告に至らず予算停止したため、期待する結末を満たさなかった。共有キャッシュの自由記述や提案の最適性は採点範囲外。 [全9件の原記録](../../../eval/results/pursuit-baseline-20261111/runs.jsonl) · [D0の共有キャッシュ実行ログ](../../../eval/results/pursuit-baseline-20261111/direct/hz12-study-cache-r1-direct_mwbgpuxy_fe66aeac.jsonl)

| 方式 | 有効設定ID |
| --- | --- |
| D0 | `c5e0158e1404c16cc34f332e0aeda3f1f49aca42e680d718939d165508d8de2e` |
| E1R | `58a98fba6f45d0e0c8c8574fef7f9ecf737414773edd24dedda468dbbcda2446` |
| `productive` | `651e38ad4def2d439f3a0b6a3cf45d0ce78d5b1cd27dfa506f5f279ffe04c6b1` |

## 判断と待機の点検

`#` は台帳の試行番号。「行」は原記録の1始まりの行番号。進展判断の理由は、台帳に保存されたモデルの説明を要約した。判断時点の入力全文や残予算の値を原記録から確定できない箇所は、当時の試行・イベントで確認できる範囲を記載した。

| 場面と位置 | 判断時点の情報 | 実際の操作と記録された理由 | 事後の結果と点検者の評価 |
| --- | --- | --- | --- |
| **進展** · 共有キャッシュの `productive`。追求 `pur_mwbh72ze_8j_db1daa32`、進展判断 `progress_mwbh8hxe_8z_a8ad2221` | #1〜6で基準と費用重視を同じ3 seedで比較済み。seed 1では費用19,370→18,486、処理数634→577、偏り48→125。偏り重視の結果は未取得。試行上限60。 | 費用低下と処理数・偏りの悪化を観測し、別の選択肢として偏り重視を同じseedで比較すると判断。#7〜9を実施。 | #13の報告と#14の読戻しに、元の比較結果を `experiment-1`〜`experiment-6` として引用。偏り重視の追加観測も引用した。ホストは `evidence` の照合に合格と判定。点検では、既知のトレードオフを根拠に別の仮説を試し、両方の観測を成果に残した進展と評価した。 [台帳](../../../eval/results/pursuit-baseline-20261111/ledger.sqlite) |
| **正当な待機** · `museum` 固定試験の `productive`。追求 `pur_2c68da99-8aa5-47f7-b260-55fca0ac2e2e`、判断 `progress_a148ebb9-0f9f-46b8-a231-4bba10073616` | #1（施設A）はイベント15行で開始、#2（施設B）は17行で開始し、32行で到着、34行で採用済み。比較に必要な施設Aは保留中。下書きは未保存。 | 施設Bの採用後にモデル要求6（38行）が `wait` を返した。固定応答の理由は定型文で、待機理由の妥当性は保留中の仕事と依頼条件から点検した。42行で実行可能な仕事なし。 | #1が43行で到着、45行で採用されるまで新しいモデル要求は0回。次の要求は49行。42→43行の時刻差は46 ms。両資料の取得後に保存・読戻しを行い、出典・回答の照合が合格。点検では、状態が変わるまでの待機と評価した。 [イベント](../../../artifacts/pursuit-baseline-20261111/fixture/museum/events.jsonl) · [判断と試行](../../../artifacts/pursuit-baseline-20261111/fixture/museum/audit.json) |
| **反復の1回目** · 修正前の一部取得不能、`productive`。追求 `pur_53455d03-63bb-41e5-ad55-45c74eadba9e`、判断 `progress_21f428ba-2bc6-4f33-9057-ade16804852c` | #2で施設Aの本文取得、#3で施設Bの必須本文の取得に失敗。根拠付きの部分回答は#4で保存、#5で読戻し済み。仮説内の試行上限6。 | 施設Bの条件が未達で部分終了を選び、確認済み内容を保存して読戻すために#6と#7を提案。 | #6の入力は#4から `stopReason` だけ変化。保存されたMarkdownのハッシュも同一（イベント44・59行）。#7は `hypothesis_budget` で拒否。点検では、既存の読戻し済み成果を変えない書込みが追加の復旧を生んだと評価した。 [判断と試行](../../../artifacts/productive-loop-20261109/release/missing/productive/missing/audit.json) · [イベント](../../../artifacts/productive-loop-20261109/release/missing/productive/missing/events.jsonl) |
| **反復の2回目** · 同じ追求、判断 `progress_d31b0e25-7535-4526-af8a-2cc076cd1a8a` | #6で同じ本文を再保存し、#7の読戻しは拒否。施設Bの新しい根拠はない。 | モデルは#6で実質的な改善がなく最新の保存後の読戻しができていないと記録し、部分終了のため#8の保存と#9の読戻しを選択。 | #8も#6から変わったのは `stopReason` だけで、イベント74行の保存ハッシュは同一。#9は成功。最終状態は `incomplete`。点検では、読戻しは直前の拒否からの回復で、#8の書込みには新しい成果がなかったと評価した。 [判断と試行](../../../artifacts/productive-loop-20261109/release/missing/productive/missing/audit.json) · [イベント](../../../artifacts/productive-loop-20261109/release/missing/productive/missing/events.jsonl) |
| **根拠を残した部分終了** · 修正後の一部取得不能、`productive`。追求 `pur_d078fa2e-79d2-47ba-9f12-ed5dd92b470d`、判断 `progress_74b8789a-ce31-4c79-9f86-2df6c0da41b5` | 骨組みを#1で保存済み。#2で施設Aの本文を取得し、#3で施設Bの指定資料が再試行不可の取得失敗。施設Bの本文は必須で、別資料による代用は不可。 | 施設Aの確認済み事項を残し、施設Bを未確認とする部分終了を選択。#4で保存し、#5で読戻し。 | イベント44行で部分回答を保存、48〜49行で独立照合1回、50行で `incomplete`。台帳の `claim` と `final` はともに出典合格（機械照合）、回答充足不合格（モデル照合）。点検では、不足を明記しつつ確認済みの根拠を残したと評価した。 [判断と試行](../../../artifacts/partial-finalization-20261109/final/missing/audit.json) · [イベント](../../../artifacts/partial-finalization-20261109/final/missing/events.jsonl) |
| **再提出・入館端末** · `live-long-20261111` のE1R。追求 `pur_mwbrlnwz_0_46e4f569`、#54 | #52で52地点すべての監査が完了し、#53の集計で未監査なし、S43不合格を確認。現行維持が確定しており、性能計測は不要。報告は未保存。 | S43の不合格を根拠に `retain`、`failed=["S43"]`、`gain=null` の保存を選択。説明用の `auditedCount`、`auditedSites`、`rationale` も入力に追加した。 | #54は `invalid_report`。#55では追加キーだけを除いて保存に成功し、#56の読戻しとホスト照合（イベント57行）を通過。点検では、結論は当初から合っており、書式による再提出が1回発生したと評価した。 [イベント52〜57行](../../../artifacts/live-long-20261111/evidence/long-terminal-entry/audit-events.jsonl) |
| **再提出・ラベル工程** · 同じ実行のE1R。追求 `pur_mwbrlnwz_1_dbe629e7`、#60 | 52地点はすべて合格。#58までの5条件では合計範囲9〜12点で結論は未確定だった。#59で6条件目が2点と分かり、合計11点で現行維持が確定。報告は未保存。 | `retain`、`failed=[]`、`gain={lower:11,upper:11}` の保存を選択。説明文を `report` に追加した。 | #60は `invalid_report`。#61で `report` だけを除くと保存に成功し、#62の読戻しとホスト照合（イベント63行）を通過。点検では、必要な計測を終えており、追加の作業は書式による再提出1回だったと評価した。 [イベント58〜63行](../../../artifacts/live-long-20261111/evidence/long-terminal-label/audit-events.jsonl) |

入館端末とラベル工程の実行は同一設定ID `fda89d003ff1b07405870f415a042a21532de00957b796c34cf02b2632b2193e`。試行上限96、仮説内6、CLI手順上限200、時間上限30分。残予算のプロンプト表示値は保存済みの記録から確定できない。再提出理由には、両件とも契約外の項目を除いたとモデルが明記している。初回エラーと再提出の入力は、許可された3キーの値まで一致した。 [長時間実行の台帳](../../../artifacts/live-long-20261111/worktree/eval/results/live-long-20261111/ledger.sqlite) · [実行集計](../../../artifacts/live-long-20261111/summary.json)

## 比較に引き継ぐ観測

初回の `submit_report` は2件とも追加キーを含み、厳密な報告スキーマで拒否された。既存のツール説明は3キーの意味を示しており、許可されるキーがその3つだけであることを文面に明記していない。修正前の部分回答で起きた同一本文の再保存は、すでに追試で2回から0回に減った。今回は、別の失敗として確認でき、書式検査と受入検証を再利用できる初回保存エラーを選ぶ。 [保存ツールと検証器](../../../artifacts/live-long-20261111/worktree/eval/tasks/terminal-study.ts) · [部分終了の追試](../partial-finalization-2026-11-09.md) · [確定した比較計画](report-submission-comparison.md)

## 第2段階に使う事後レビューの事例

Evaluator 0.1.0を接続した実モデル検証では、`museum` の保存済み報告は指摘0件、`missing` は必須の施設B本文が未確認と指摘された。この接続は元の依頼、報告、報告が引用した取得本文を評価する。実行時の試行や判断は台帳とイベントで確認する。 [接続の仕様](../../../examples/eumenes/README.md#保存した報告の事後レビューevaluator) · [導入時の実測](../../../artifacts/evaluator-integration-20261111/api.RTZCYH/summary.json)

| 事例 | 原記録から確認したこと | 履歴評価で確かめること |
| --- | --- | --- |
| **50区画・Steerなし** | 保存されたMarkdownは50区画すべてでカードの内容と引用が一致。Pursuitの採点入力に含まれた台帳抜粋は18〜20区画分で、採点理由では保存の証拠も確認できなかった。最終状態は `incomplete`。台帳全文と引用資料を受け取ったEvaluatorは指摘0件。 | 「保存された成果は検証済み」「Pursuitの採点時には証拠が不足」をそれぞれ記録できるか。Evaluatorの指摘0件はレビュー結果として扱い、成果の一致は独立した照合結果で判断する。 [採点入力と照合結果](../../../artifacts/steer-evaluator-20261111/summary.json) · [Evaluator出力](../../../artifacts/steer-evaluator-20261111/control/evaluation.json) |
| **50区画・Steerあり** | 補足は到着後の次の判断に一度だけ届き、台帳の直接取得に使われた。カード5件を取得した後、`hypothesis_budget` で未完了となり、保存済みの報告は初期の下書きだった。Evaluatorは報告の欠落を1件指摘した。 | 報告の欠落を確認しつつ、Evaluatorの説明にある「取得手順が実行されていません」は、台帳とカード5件の取得記録と照合して訂正できるか。 [試行と終了理由](../../../artifacts/steer-evaluator-20261111/steer/result.json) · [Evaluator出力](../../../artifacts/steer-evaluator-20261111/steer/evaluation.json) |

前回の50行入りの報告2件も、台帳全文を用いた事後レビューでは指摘0件だった。最新の比較はSteerあり・なし各1回で、あり側は5区画で終了している。時間やトークンは到達した成果と併記する。 [前回報告の評価と比較の計測](../../../artifacts/steer-evaluator-20261111/summary.json)
