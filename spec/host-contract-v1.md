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
