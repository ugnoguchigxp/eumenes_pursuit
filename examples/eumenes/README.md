# Eumenes の Web 調査をローカルで再現する

Pursuit を Eumenes と同じ入力形式、道具の契約、出典 ID と独立した受入検証で動かす。専用の SQLite とファイルを指定先に作る。Eumenes の稼働環境、設定、会話、採用版には接続しない。

```sh
bun examples/eumenes/run.ts fixture productive museum artifacts/example-museum
bun examples/eumenes/run.ts fixture legacy museum artifacts/example-legacy
bun test ./test/scenario/eumenes-example.test.ts
```

`technical,museum,denied,missing,conflict,cap` を指定できる。固定試験モードは検証用の資料・応答を使い、ネットワークや有料推論を使わない。実モデルで検証する場合は、Pursuit の単独実行用設定と API 認証を用意し、`fixture` を `api` に替える。Eumenes のサービスには接続しない。実モデルも Web の返却資料は同じ固定資料を使う。前版の `src` を最後の引数に指定して `legacy` を実行すると、その前版の engine と migration が使われる。結果を上書きしないよう、実行ごとに新しい出力先を指定する。

`events.jsonl` には開始・受領・採用を別々に記録する。モデル呼出しの用途、時間、トークンと、待機・Web・Markdownの時間を集計する。集計の時間は重なり得る。 `audit.json` には試行、取得本文、判断、検証、出典と下書きが入る。保存後のMarkdownは `report_draft.answer` と同じバイト列。取消後は公開しない。検証に実データを混ぜる場合は、出力ディレクトリを共有しないこと。

- `sync.ts` は Eumenes のソースから Web・再読・下書きの道具、資料と下書きの契約、指示、ポリシー、Markdownのファイル名と書込み部分を取り込む。独立検証の原本は参照用に保存し、exampleの検証は `acceptance.ts` で管理する。引用本文が総量の上限に収まる場合は全文を最終採点に渡し、現行下書きと保存済みMarkdownのバイト列を照合した記録を添える。ソースのパスとSHA-256は [provenance.json](provenance.json)。取り込み時の作業木の内容を保存するため、記載した HEAD と完全一致するとは限らない。
- 実際の Web クライアント、Eumenes の共通推論キュー、Scratch、Docling は同梱しない。取得の応答と待機、保存先、外部推論の receipt は隔離したホストで置き換える。Markdown のバイト列とファイル名は取り込んだ `writeLocal` で作り、下書きのバージョンを採用してから結果を公開する。
- 実行は一調査一ホスト。別の出力先を使えば独立に実行できる。同じ保存先を複数のプロセスから同時に開かない。停止・再開の試験では `openExample` で同じ設定と保存先を開く。保存済み receipt は再実行しない。発行中に落ちて結果が不明な Web・モデル呼出しは自動再発行しない。隔離されたMarkdownファイルは同じIDで安全に書き直せる。

Eumenes ソースの更新を取り込む場合:

```sh
bun examples/eumenes/sync.ts /path/to/eumenes
bun run format
bun test ./test/scenario/eumenes-example.test.ts
```

## 最終照合の確認

`events.jsonl` の `acceptance_input` と `acceptance_result` は、採点入力のハッシュで突き合わせられます。台帳の条件別結果には、対象の報告の版、実際に送った出典の範囲、現行Markdownの保存記録が残ります。

必須条件の不適合と、採点に渡った根拠が足りず判定できなかった場合を区別します。後者で `verificationIssue` が `evidence_unavailable` のときは、ホストが必要な根拠を用意した後に既存の `engine.reverify` で照合だけをやり直せます。同じ入力での自動再照合は行いません。再照合は検証結果を更新し、確定済み操作や終了状態には影響しません。

`bun test ./test/scenario/eumenes-long-research.test.ts` で、15資料の取得と長い資料の再読、方針更新時の保存、中断・再開、現行Markdownと全出典の最終照合を固定応答で確認できます。入力サイズを測る場合は `PURSUIT_MEASURE_FIXTURE=1` を付けます。

`openExample` の `sourceRanges: true` は、出典ID・保存版・実際に表示した本文の範囲をSolverに渡す比較用の設定です。通常は検証情報の引き継ぎを使い、範囲表示は設定を明示した実行で有効になります。 [Solverのフリーズ記録](../../spec/verification/long-term-pursuit/solver-freeze.md)

## 実行中の補足（Steer）

`openExample` の `steering` に共有 Inbox、補足に使える入力バイト数、対象 Pursuit に結び付く出典と版を照合する `resolve` を渡すと、`productive` の次手判断に補足を渡せます。送信側は、起動後に返る `steeringTarget` の対象ID・世代と、確定済みの出典ID・版を使って Inbox に登録します。

補足本文は既存の次手判断の入力にだけ入り、資料として扱われます。送信済みか不明なバッチは自動再送せず、応答を保存・採用する時点と以後の操作で、使った出典の版を再確認します。受付の状態はメモリ上にあり、終了やホストの閉鎖で破棄されます。再開後は新しい世代を使います。

開発用に固定したパッケージは eumenes-steer 0.1.0、コミット `1250b20`、アーカイブ SHA-256 `1ca04b8bee9b839016a14987fc903282c1b57665eca1e89457681c3990f1e705` です。検証は `bun test ./test/scenario/eumenes-example.test.ts` または `bun run verify` で実行できます。[Steerの公開契約](https://github.com/ugnoguchigxp/eumenes_steer/tree/1250b20)

## タスク実行中のレビュー（Evaluator）

```sh
bun examples/eumenes/run.ts api productive conflict artifacts/evaluator-during-task --evaluator-tool
```

`--evaluator-tool` は `productive` に `report_review` を追加します。Pursuitは必要なときに報告を保存し、具体的な確認事項を指定してレビューを依頼できます。Evaluatorには元の依頼、確認事項、保存済みの報告とその引用本文を渡します。Pursuitは指摘を原資料に照らして採用を判断し、最終完了は既存の受入検証で判定します。

レビューは追求の推論・試行予算に含まれます。採用した点検の記録は最終採点にも渡り、点検対象の報告が現行版と同じかを確認できます。出力は通常の試行として `audit.json` に残り、`summary.json` の `model.evaluatorToolCalls` と `usage.byRole.evaluator_tool` で使用量を確認できます。

## 保存した報告の事後レビュー（Evaluator）

```sh
bun examples/eumenes/run.ts fixture productive museum,missing artifacts/evaluator-fixture --evaluator
bun examples/eumenes/run.ts api productive museum,missing artifacts/evaluator-api --evaluator
```

`--evaluator` は保存済み報告を固定JSONとして Evaluator の `workflow-correctness` で1回レビューします。元の依頼、報告、主張が引用した取得本文を渡し、取得できていない引用や切り詰められた引用を未確認として扱います。報告が未保存なら評価を省略します。Pursuit の完了状態と独立した事後レビューで、台帳の実行履歴や判断時点の妥当性は評価範囲に含みません。

各課題の `evaluation.json` に対象の識別子・ダイジェスト、指摘、根拠の位置、資料ごとの確認状態を保存します。Evaluator の `completed` は評価処理が完了した状態であり、指摘は `findings` で確認できます。エラー・取消・期限超過は実行の終了コードにも反映されます。固定試験では定型応答で入出力を検証します。実モデルでは `llm.reviewer` を使い、`summary.json` の `evaluation` に所要時間とトークン数、`usage.byRole.evaluator` に呼出回数と費用が入ります。APIには報告と引用本文が送信されます。

開発用依存は eumenes-evaluator 0.1.0（`6aec373`）、アーカイブ SHA-256 `f0dc0fd7e6821a9562c08b019224150f7fa65fb72b2d29e0e26cde63d6c6aa2d` に固定しています。
