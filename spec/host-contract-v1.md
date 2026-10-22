# ホスト接続契約 v1

作成日: 2026-10-20
状態: 初版（P0）。中身は作り替えてよいが、ここに書いた接点は版を上げて変更する。
型の正本: `src/contracts/`（`db.ts`・`ports.ts`・`judge.ts`・`pursuit.ts`・`policy.ts`）。

## 位置づけ

- eumenes-pursuit は Eumenes の会話エージェント（`agent-runtime`・`coding-supervision`・`conversation`）とは**別の**背景処理である。会話の文脈を持たず、台帳だけから状態を組み立て直して進む。
- Eumenes の `goals` の目標とは `goalRef`（不透明な文字列）でだけ結ぶ。pursuit は goals の表を読まない。
- 配布は `eumenes-world-model` と同じ形（版つき tgz を Eumenes の `vendor/` に置く）。公開の入口は `eumenes-pursuit`（engine・契約・質問セット）と `eumenes-pursuit/sqlite`（migration・読み取り）だけ。
- `standalone/`（LARM 接続・Claude API・単独 store・設定）と `eval/` は tgz に入れない。

## 保存

| 面 | 契約 |
| --- | --- |
| 接続 | ホストが `LedgerDb`（`bun:sqlite` の `Database` が構造的に満たす）を貸す。pursuit は接続を開かない・閉じない・PRAGMA を打たない |
| transaction | `PursuitStore.write(op)` / `readSnapshot(op)`。callback は同期。ホストの単一 writer（Eumenes の `store.write` / `store.readSnapshot`）にそのまま対応する |
| migration | `migrations: MigrationDescriptor[]`（id・sql・sha256）。ホストの migration 列の末尾に追加する。表名はすべて `pursuit_` で始まる |
| 競合 | 追求ごとの `revision`。古い revision での書き込みは `RevisionConflictError` |
| 再送 | `start(input, operationKey)`。同じ key と同じ入力は保存済みの追求を返し、入力が違えば `operation_conflict`（Eumenes `goals` の operationKey と同じ考え方） |
| 不変 | 受入条件は trigger で更新・削除を拒否する |

## 実行

`createPursuitEngine(deps)` が返す engine を、ホストが一手ずつ呼ぶ。

| 呼び出し | 内容 |
| --- | --- |
| `start(input, operationKey)` | `StartInput`（目標・受入条件・grant・policy・conditions・goalRef・label）を検証して追求を作る |
| `step(id, runtime, signal)` | 状態に応じた一手（方針 / 仮説 / 提案と実行 / 振り返り）を進め、`StepResult` を返す。一手の中で LLM・判定器・道具を呼び、結果をその都度 transaction で残す |
| `answer(id, consultationId, text)` | 相談への回答。`awaiting_consultation` から再開する |
| `cancel(id, reason, runtime, signal)` | 停止して報告を作る |
| `view(id)` | 台帳全体（`PursuitView`） |

- 一手は「読む（snapshot）→ 外部呼び出し（非同期）→ 書く（transaction）」の繰り返しである。Eumenes では queue の handler（prepare / execute / settle）として 1 追求 1 handler で回せる。会話の区切りや一晩をまたいでも、台帳から再開する。
- 実行中に落ちた試行（`started` のまま）は、次の `step` が `interrupted` にして、仮説の checkpoint に戻す。
- 相談は非同期である。engine は待たずに `awaiting_consultation` で止まり、回答はホストが後から渡す。

## port

| port | 責務 | 単独 | 取り込み後 |
| --- | --- | --- | --- |
| `ToolPort` | 道具の一覧（名前・説明・入力 schema・副作用・権限・指紋の項目）と呼び出し | `eval/tasks` の実道具 | Eumenes の toolchain |
| `WorkspacePort` | checkpoint・restore・digest・変更の特徴量（触ったファイル・変更行数・検査への接触） | 使い捨てディレクトリ | toolchain の作業領域 |
| `AcceptancePort` | 受入条件の照合。手順は実行側から見えない | 隠した検査 | Eumenes 側の照合 |
| `JudgePort` | d1 への一括質問（最大 16 問） | `standalone/larm` | Eumenes の `larm` domain |
| `LlmPort` | 構造化出力の一回呼び出し（毎回新しい文脈）。生成層と振り返りで別の port を渡す | `standalone/claude.ts` | Eumenes の LLM 接続 |
| `Clock`・`IdSource` | 時刻・id | `Date.now`・乱数 | ホストのもの |

core（`src/`）は時計・乱数・ネットワーク・ファイル・`process` を直接使わない。`scripts/check-boundaries.ts` で検査する。

## 出力

- 台帳: 方針・仮説・試行（予測・観測・指紋・特徴量）・判定（質問の版・答え・閾値・使えたか・model・adapter）・判断（種類・理由・根拠・決めた担当）・相談・照合・推論の使用量。
- 報告 `Report`: 結末（completed / incomplete / stopped）、`verified`（ホストの照合が通ったときだけ true）、理由、照合の結果、相談で必要なもの、参照、件数。
- モデルの生の応答は残さない。構造化した項目だけを残す。

## ContextStill への受け渡し（後続）

- 渡すもの: 目標と受入条件、試行ごとの「条件（指紋・入力）・道具・予測・観測・判断」、成果物・出典の参照。
- 保持: 台帳は ContextStill が取り込んだと確認できるまで消さない。削除の API は v1 には置かない。

## 変更の手順

この契約を変えるときは、本書の版を上げ、`spec/` に差分と理由を書いて合意を取ってから実装する。

## v1.1（2026-10-20、追加のみ）

[spec/findings-design.md](findings-design.md) の知見の保持に伴う追加。v1 の呼び出し側はそのまま動く。

- migration `pursuit-0002-findings`（表 `pursuit_finding`）。
- `conditions.findings`: `"off" | "verified" | "all"`（必須の項目。v1 の入力は `"off"` を付けて渡す）。
- `ToolOutcome.findings?`、`CriterionResult.findings?`・`CriterionResult.assurance?`（`exact` / `numeric` / `model`）。
- `ToolDescriptor.textField?`（長い本文を JSON の外で渡す）、`ToolDescriptor.readsWorkspace?`。
- `Report.findings`（有効な知見の件数と、照合済みの知見の一覧）。ContextStill への受け渡しの候補。
- policy に `budget.transitions`、`judge.trajectoryPersist`、`restore`（`always` / `protective`）。

## v1.2（2026-10-20、追加のみ）

- `conditions.strategyChange`: `"free" | "distinct"`（既定 `"free"`。省略した入力と、v1.1 までの台帳は `"free"` として読む）。`distinct` は、方針を立て直すときに、これまでのどの方針とも核となる考え方が違う方針を求め、まだ採っていない別案を一覧で示し直す。
- `conditions.findings` も既定 `"off"` にした（v1 の台帳をそのまま読めるように）。
- `conditions.selfCheck`: `"off" | "parts"`（既定 `"off"`）と policy の `consultation.requireProgress`（既定 false）、migration `pursuit-0003-parts`。[spec/persistence-design.md](persistence-design.md) を参照。

## v1.3（2026-10-20、追加のみ）

- `conditions.verifyOn`: `"attempt" | "claim"`（既定 `"attempt"`）。`claim` では、照合は完了の申告のときと終わるときだけ行う。
- `conditions.prediction`: `"status" | "falsifiable"`（既定 `"status"`）。`falsifiable` では、道具の提案に `refutedIf` が要り、空か予測と同じなら規則層が `prediction_not_falsifiable` で拒否する。台帳の予測（`prediction_json`）に `refutedIf` が入る（列の追加はない）。
- 試行ごとの照合と最終の照合からは、知見を作らない。知見を作るのは、完了の申告のときの照合だけ（隠れた採点の漏れを塞ぐ）。
- [spec/verification-design.md](verification-design.md) を参照。

## v1.4（2026-10-21、追加のみ）

- `conditions.completionCheck`: `"off" | "acceptance"`（既定 `"off"`）。
- 道具の記述子に `readsBack?: boolean`。成果物そのものを返す道具に付ける。
- [spec/completion-design.md](completion-design.md) を参照。

## v1.5（2026-10-22）

- 照合結果のIDの完全性を検証する。stopped / incompleteは最終照合前に保存し、照合不能でも終了状態を維持する。
- `Report.verificationIssue?`: `pending | aborted | failed`（省略可能、既存のJSON列に保存）。
- [レビュー修正の設計と完了条件](review-fixes-2026-10-22.md) を参照。

## v1.6（2026-10-22）

[追加評価10件の実装記録](improvement-implementation-2026-10-22.md) に伴う変更。今回はユニットテストまで確認し、包括的な検証は別担当へ引き継いでいる。

- migration `pursuit-0004-settlement`: `pursuit_attempt.settlement_json` に `need_post_judge / need_acceptance / need_rules / done` と対象workspace digest、判定の効果を保存する。結果保存済みの道具を再実行せず、未完了の確認を先に再開する。期限切れ・明示的な終了は終端状態を保存して未完了処理を閉じる。確認不能は記録し、合格の根拠にはしない。
- migration `pursuit-0005-finding-sources`: `pursuit_finding.source_verification_id` を追加する。同じ主張でも保証水準・出典・適用範囲の異なる根拠を保持する。旧行の出典は上書きしない。
- 試行の指紋は `v2:<道具契約の識別値>:<入力と状態の識別値>`。文字列の空白・改行は保持する。`ToolDescriptor.legacyFingerprintCompatible?` は、ホストが旧版と同じ指紋対象フィールド・状態依存性であると確認した場合だけtrueにする。宣言がなければ、旧履歴との比較は「照合不能」として見直しを求める。開始操作の再送判定は変更しない。
- `interrupted` の `outcome` はnull（結果不明）。副作用なしを意味しない。試行予算を消費し、同条件の再試行に理由と回数制限を適用する。
- コアは注入された時計で待機後・新規実行前に期限を確認する。ホストは残り時間でPortを中断し、相談待ちを除外する。評価ホストは `stepWithDeadline / cancelWithDeadline` を使用する。他ホストも同じ責任を持ち、同じpursuitのstepを並行実行しない。
- D群の隠し検査はホスト所有の入力ケース・期待値比較へ移行した。提出コードの実行プロセスには期待値を渡さず、返り値・例外だけを未信頼のデータとして受け取る。ログの成功表示は合否に使わない。
- E群採点は項目IDの完全性・一意性を検証し、ホストの検算結果を保証水準付きで渡す。数値近似を厳密な証明へ昇格させない。
- 評価結果は `configId / jobKey` で識別する。旧記録はlegacyとして保持する。非公開データを使う評価では `--private-data-version` に内容変更時に更新する版IDが必要。
- ホストの `usage_call` を利用量・費用の正本とし、job・役割・呼出しごとに保存する。`RunRecord.usd` は金額不明ならnull。ファイル応答のトークンは推定であり、請求額や実際の応答モデルは推定しない。

## v1.7（2026-10-22）

[評価で見つかった問題の改修](fixes-2026-10-22.md) に伴う変更。既定値の付いた項目の追加だけで、v1.6 の呼び出し側はそのまま動く。migration は無い。

- `conditions.rollback`: `"notify" | "keep"`（既定 `"notify"`）。一段上へ戻るときの巻き戻しは黙って行わない。`notify` は戻したファイルを判断の `basis.reverted`（と `basis.attemptsAtRevert`）に残し、次の試行までの生成要求で名指しする。`keep` は戻さない。
- `conditions.verdictLabel`: `"refutation" | "status"`（既定 `"refutation"`）。試行の判定の表示は、機械で判定できる `refutedIf`（`status:ok|error`、`contains:"…"`、`not_contains:"…"` を `||` で並べたもの）に基づかせる。それ以外は「未判定」とし、道具の状態だけで「予測どおり」とは表示しない。`status` は v1.6 の表示。`outcome` は変わらない。
- `policy.signals.scratchDirs`（既定 `["scratch", "notes", "tmp", "__pycache__"]`）。`scope_growth` は、作業領域を変える試行が、その仮説でまだ変えていなかった課題のファイルを続けて新たに変えた回数で数える。読むだけの試行と scratch のディレクトリの下のファイルは数えない。
- 規則 `finding_not_recorded`（`conditions.findings` が off 以外で、規則層が有効なとき）: 提案が台帳にない F番号を引用したら拒否する。見るのは uses / refute と、message・自己評価・受入条件ごとの判断の中の F番号。知見が 0 件のまま試行が 5 回以上実行されたら、方針と仮説の要求で記録を促す。
- `policy.observation`（既定 `{ latestChars: 8000, olderChars: 1800 }`）。生成要求の中で、最後に実行した試行の観測は latestChars まで、それ以外は olderChars まで表示する。切ったときは全体の長さと続きの読み方を示し、入力 schema に `offset` / `limit` を持つ道具ならそれで読めると伝える。台帳の観測は切らない。
