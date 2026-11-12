# Optimizerの取引合計 実証課題

4種類の基礎サンプルの初期状態を、同じ取引集計の仕様で確認できる。各取引について、同じ利用者の `t - 3600 < t' <= t` の取引額を合計し、入力順に出力する。同時刻の取引と返金を含む。速度の目標は20万件を1実行3秒以内。 [入出力仕様](../../eval/tasks/e/env-work/hz10e-window-sums/README.md)

| サンプル | 初期版の問題 | 期待する修正 |
| --- | --- | --- |
| [all-scan](starters/all-scan.py) | 正しいが、取引ごとに全利用者の全取引を走査する。 | 走査を減らし、出力を維持する。 |
| [per-user-scan](starters/per-user-scan.py) | 正しいが、利用者別に分けた後も同じ利用者の全取引を走査する。取引が少数の利用者に集中すると遅い。 | 利用者内の走査を減らす。集中した入力を主指標にし、他の分布での悪化も確認する。 |
| [closed-left](starters/closed-left.py) | 窓の左端を含めるため、ちょうど1時間前の取引を誤って加算する。 | 3599秒差を含み、3600秒差を除く。 |
| [same-time](starters/same-time.py) | 同時刻の取引を順次反映するため、その時刻の先頭行で合計が不足する。 | 同じ時刻の全取引を各行の合計に反映する。 |

## 難課題

[corrections](starters/corrections.py) では、同じIDの置換、利用者・時刻の移動、額の増減と削除が交互に入る。照会ごとにその時点の件数・合計・最新IDを返す。初期版は同じIDの再登録を無視し、窓の左端を含める。これを直しても全取引の走査が残り、20万操作の性能要件が残る。 [台帳の入出力仕様](ledger/README.md)

[snapshots](starters/snapshots.py) は保存と復元を追加する。同じ保存点からの分岐、保存名の上書き、復元先ごとに変わる照会結果を扱う。初期版は保存先と現行状態を共有するため、保存後の編集が過去の状態に混入する。正しさだけを直して全状態を毎回複製すると、大きな台帳で時間とメモリを消費する。 [分岐の仕様](ledger/snapshots.md)

実モデル対象の [bulk-snapshots](starters/bulk-snapshots.py)。分岐と復元に加え、各枝の現時点で条件に合う取引だけを一括訂正する。後から登録する取引、移動・削除、別の枝に誤って訂正を引き継がないことを検査する。未使用の10万操作を1実行3秒以内で処理する。 [一括訂正の仕様](ledger/bulk.md)

[network-parity](starters/network-parity.py) は、リンクが置換・削除されるネットワークで、矛盾の有無と連結成分の重みを照会する。初期版は同じIDを置き換えず、照会ごとにグラフを作り直す。未使用の6万操作を1実行3秒以内で処理する。 [ネットワークの仕様](network/README.md)

`network-versions` は同じネットワークに状態の保存・復元を加える。初期版は保存時に状態への参照を使い回すため、別の分岐の更新が保存済みの状態にも入る。正しい全コピー版は初期版とは別に比較基準として使う。 [保存と復元の仕様](network/versions.md)

[inventory-branches](starters/inventory-branches.py) は、木で表された配送網で、指定の品目と距離範囲に合う在庫のある拠点数・在庫合計を求める。数量の置換や保存・復元を含む。初期版は保存先と現在状態を共有し、照会ごとに配送網を走査する。未使用の5万操作を1実行3秒以内で処理する。 [配送網の仕様](inventory/README.md)

[range-moments](starters/range-moments.py) は、長い配列で区間のアフィン変換、3種類の集計、保存・復元を処理する。初期版は保存先と現在状態を共有し、更新・照会ごとに区間を走査する。未使用の36,000操作を1実行3秒以内で処理する。 [区間更新の仕様](range-moments/README.md)

`compare` は、既存の直接解法（D0）とOptimizerに、同じ初期版・道具・採点器・モデル設定・上限を渡す。D0は一手ずつ操作し、Optimizerは追求ループで仮説と進捗判断を使う。道具が提供する計測と最良候補の保存は両方で使える。作業領域は方式ごとに分け、各方式の提出版を同じ未使用入力で照合する。

```sh
bun examples/optimizer/run.ts compare all artifacts/optimizer-examples/hard-1
```

1課題を複数回比較するときは、2回目に `--optimizer-first` を指定すると実行順を逆にできる。

## 実行

OptimizerのCLIはリポジトリのソースから実行する。`pack:core` で生成するコアライブラリのアーカイブにはCLIや評価用の依存は入らない。

取引台帳・配送網などのPython課題には、Linux、Bun、`/usr/bin/python3`、`/usr/bin/bwrap`、`/usr/bin/prlimit` が必要。候補のPythonはネットワークなしの隔離環境で動く。まず初期状態だけを調べる。

```sh
bun examples/optimizer/run.ts inspect all artifacts/optimizer-examples/inspect-1
```

ISUCON12予選のランキング課題は [macOS向けの実行手順](isucon12/README.md) を参照。課題名 `isucon12-ranking` を指定すると、この課題だけを実行する。

実モデルを使う場合は、Pursuitの単独実行用設定で `llm.generator` と使用量上限を設定し、対応するAPI認証を用意する。既定の設定データベースを使う。別の設定ファイルは `OPTIMIZER_SETTINGS` で指定できる。

```sh
bun examples/optimizer/run.ts api all artifacts/optimizer-examples/api-1
```

基礎4件と `corrections`・`snapshots`・`network-parity`・`network-versions` は実モデル実行から引退した。`inspect` での初期確認と過去の結果を利用できる。実モデル実行で `all` は現役の課題だけを選び、引退した課題を名指しした場合もモデル呼び出し前に拒否する。

出力先は実行ごとに新しいディレクトリを指定する。各サンプルでモデルの呼び出しは最大17回、道具は最大20回、速度計測は最大6バッチ。モデルに渡す作業領域には、そのサンプルの初期版と共通仕様を置く。

`api` と `compare-selection` が中断した場合は、同じ課題指定、実装、出力先、モデル設定で再開できる。Codexを使う場合はブリッジも同じ場所で起動する。

```sh
bun examples/optimizer/run.ts api all artifacts/optimizer-examples/api-1 --resume
```

再開時は候補、測定の校正、台帳、使用済みのモデル呼び出し枠を引き継ぐ。追求の期限は初回起動を基準にする。中断した計測は自動で再実行されず、モデルが明示的に再試行する場合も計測枠を使う。終了済みの課題は結果を読み戻す。プロセス停止などで使用量を取得できなかった呼び出しは `unobservedUsageCalls` に残る。

Responses APIの一時的な接続障害やHTTP 5xxでは、予算と期限が残っていれば `api-pause-<呼び出し番号>.json` に理由、最良版、利用量が不明な呼び出しIDを記録して停止する。障害があった呼び出しも上限に含む。認証エラーやクォータ枯渇は終了として記録する。

利用量が不明な呼び出しは既存の予算ガードで停止する。 `bun standalone/cli.ts budget show` で状態を確認し、請求資料または承認済み上限に基づく `spend reconcile` を行ってから、同じ接続先で `--resume` を使う。 `OPTIMIZER_SETTINGS` で設定DBを変えた場合は、照合CLIの `PURSUIT_SETTINGS` にも同じパスを指定する。 [予算照合の手順](../../README.md#apiの選択と費用の復旧)

候補の自動採用だけを比較する場合は、同じ追求ループを両方式で使う `compare-selection` を実行する。手動側は合格した計測のIDを `adopt_candidate` に渡す。両方式とも最良版の復元、正しさ、速度、公開前の独立監査は共通。

```sh
bun examples/optimizer/run.ts compare-selection inventory-branches artifacts/optimizer-examples/selection-1
```

候補の状態と計測範囲の提示だけを比較する場合は `compare-state` を使う。両方式が同じ追求ループ、採用・受入条件、独立監査を使う。2回目は `--reverse-order` で各課題の実行順を反転する。

```sh
bun examples/optimizer/run.ts compare-state all artifacts/optimizer-state/r1
bun examples/optimizer/run.ts compare-state all artifacts/optimizer-state/r2 --reverse-order
```

`compare-measurement-summary` は、`measure_candidate` がモデルへ返す全測定値だけを省く。採否の根拠は応答に残り、全測定値は候補台帳で確認できる。

```sh
bun examples/optimizer/run.ts compare-measurement-summary all artifacts/optimizer-measurement-summary/r1
bun examples/optimizer/run.ts compare-measurement-summary all artifacts/optimizer-measurement-summary/r2 --reverse-order
```

## Codex LunaとWeb検索で比較

Codex CLIの `gpt-6-luna / medium` とネイティブのライブWeb検索を両方式に使う。各方式の最初の呼び出しで、課題の非公開情報を検索語に含めず、一般的な関連技術を1回調べるよう依頼する。検索実行件数と、Codexが返すInput／Cached／Outputを記録する。Codexの作業場所は空の読取り専用ディレクトリで、候補の読取り・編集・検査は実証ランナーの道具で実行する。

Inputはキャッシュに当たった入力を含む総数で、Cachedはその内数。呼び出し数はランナーからCodex CLIに渡したターン数で、各ターンにはCLIが組み立てる入力も含まれる。

次の1行目をCodex CLIとAPI認証を使えるホストで起動し、2行目を別ターミナルで実行する。候補実行はLinuxの隔離環境が必要。ホストとLinuxが異なる場合はブリッジのディレクトリを両方にマウントする。API認証はCodex側に置く。

```sh
bun examples/optimizer/codex-bridge.ts artifacts/optimizer-examples/codex-bridge-1
OPTIMIZER_CODEX_BRIDGE=artifacts/optimizer-examples/codex-bridge-1 bun examples/optimizer/run.ts compare all artifacts/optimizer-examples/codex-1
```

## 判定と記録

1. 初期版の出力を照合し、正しい初期版だけを、その課題の件数・操作数で計測する。
2. モデルが変更した版を正しさの検査にかける。合格した版を計測し、検証済みの最良版と比較する。正しい初期版がある課題ではその版から比較を始める。初期版に誤りがある課題では、共通の全件走査版を比較に使う。
3. モデルが完了したら、作業領域から独立した未使用入力をホスト側で照合する。課題が定めた大規模入力を3分布で各7回実行し、出力が期待値と一致し、時間上限を満たし、検証対象版と公開版が一致したときに成果物を公開する。

各サンプルの `initial.json` に初期状態、`calibration.json` に時間計測の校正、`result.json` に終了状態・採点・使用量を保存する。合格版は同じディレクトリの `windowsum.py` に出力する。終了時に検証済みの改善候補を保持している場合は、`best-partial.py` にその候補を保存できる。全体の結果は `summary.json` で確認できる。 [Optimizerの検証計画](../../spec/optimizer-first-validation-plan.md)

監査全体の期限は、正しさ検査の件数、分布ごとの予熱と本計測の回数、1回3秒の上限から設定する。監査の合否・時間切れ・中断・実行エラーは `auditStatus` で確認できる。開発用の正しさ検査は、出力が異なる場合に最初の差分行を返す。計測応答の先頭には、候補版、比較版、分布ごとの差の中央値・閾値・採否の根拠を置く。全測定値は候補台帳に残る。

校正で、ばらつきの閾値が比較版の中央値の20%を超えた分布があれば、課題の各方式を `optimizer_calibration_unstable` の未実行として記録する。このときモデルは呼び出さない。通常の採用閾値は、同一版どうしの測定で得たばらつきを使う。

## 実モデルでの実行結果

2026-11-12の実証では `gpt-6-luna / medium` で各基礎サンプルを1回ずつ実行し、4件とも合格した。各提出版の未使用20万件入力は21回すべて期待値と一致した。最長時間は all-scan 0.371秒、per-user-scan 0.259秒、closed-left 0.293秒、same-time 0.413秒。

最初の試行では4件とも作業領域の操作順を既存の実行ループに拒否された。実証例の依頼に最初の読取りと操作の直列実行を明記し、別の出力先で試し直した。 [初回の集計](../../artifacts/optimizer-examples-20261112/api/summary.json) · [再試行の集計](../../artifacts/optimizer-examples-20261112/api-sequential/summary.json)


## 難課題の比較結果

2026-11-12に `gpt-6-luna / medium` を使い、同じ資料・道具・採点器・上限（モデル17回、道具20回、計測6バッチ、480秒）で各方式を1回実行した。各組はD0から開始し、提出版は同じ未使用入力で照合した。

| 課題 | D0 | Optimizer | Output（D0 → Optimizer） |
| --- | --- | --- | ---: |
| `corrections` | 合格、14呼び出し | 合格、9呼び出し | 14,804 → 10,345 |
| `snapshots` | 合格、8呼び出し | 部分終了、16呼び出し | 4,635 → 28,301 |

`snapshots` の参照実装とD0の提出版は、どちらも未使用20万操作の全21実行で出力が一致した。Optimizerは正しさを確認した候補を2版計測したが、どちらも速度改善の基準を満たさなかった。最初の候補は保存と復元の全状態コピーを残しており、3分布で比較版より遅かった。2版目の通常分布での改善は校正したばらつきの範囲内だった。

今回追加した2件はD0でも完了したため、Optimizerだけが解ける難易度は確認できていない。 `snapshots` は、保存状態のコピーを残した案から計測結果をもとに立て直せるかを点検する課題として使える。 [訂正の比較](../../artifacts/optimizer-corrections-20261112/compare/summary.json) · [分岐の比較](../../artifacts/optimizer-snapshots-20261112/compare/summary.json)

## 一括訂正課題の比較結果

2026-11-12に `gpt-6-luna / medium` で各方式を1回実行した。上限はモデル17回、道具20回、計測6バッチ、480秒。独立した参照実装は64件の正しさ検査に合格し、未使用の10万操作を3分布で各7回正しく処理した。最長1.285秒だった。 [事前検証](../../artifacts/optimizer-bulk-snapshots-20261112/preflight.json)

| 方式 | 最終結果 | モデル呼び出し | Input | Cached | Output |
| --- | --- | ---: | ---: | ---: | ---: |
| 直接実行（D0） | 未達 | 17 | 108,764 | 0 | 8,101 |
| Optimizer | 合格 | 14 | 107,179 | 21,828 | 30,569 |

D0は最初の候補が正しさの検査で不合格となり、その後はコードを10回読み直した。新しい候補を保存する前にモデル呼び出し上限に達した。Optimizerは最初の候補を採用せず、次の候補で正しさと速度改善を確認して提出した。提出版は未使用の10万操作で全21回の出力が期待値と一致し、最長1.172秒だった。 [比較結果](../../artifacts/optimizer-bulk-snapshots-20261112/compare/summary.json) · [提出版](../../artifacts/optimizer-bulk-snapshots-20261112/compare/bulk-snapshots/optimizer/windowsum.py)

最初の候補をモデル呼び出しなしで再点検すると、未使用の正しさ検査14件と10万操作の計21実行に合格し、最長1.340秒だった。通常分布では基準版より7回すべて速かったが、差の中央値6.998 msが、固定したばらつきの基準7.563 msを下回ったため採用されなかった。この候補は比較結果の合格件数に加えていない。 [候補の事後検証](../../artifacts/optimizer-bulk-snapshots-20261112/candidate-audit.json)

## CodexとライブWeb検索の比較結果

2026-11-12にCodex CLI 0.162.1の `gpt-6-luna / medium` を使った。各方式は1回ずつで、同じモデル・資料・採点器・操作上限を使った。ライブWeb検索は各実行で1件だった。合格した4提出版はすべて、未使用入力の21実行で出力が一致し、提出ファイルと検証対象のハッシュも一致した。

| 課題 | 方式 | 結果 | 最長時間 | 呼び出し | Input | Cached | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `bulk-snapshots` | 直接実行 | 合格 | 0.880秒 | 9 | 219,348 | 61,506 | 14,312 |
| `bulk-snapshots` | Optimizer | 合格 | 1.036秒 | 10 | 220,675 | 13,806 | 26,399 |
| `network-parity` | 直接実行 | 合格 | 0.293秒 | 7 | 134,494 | 28,067 | 5,520 |
| `network-parity` | Optimizer | 合格 | 0.268秒 | 8 | 157,367 | 13,776 | 15,800 |

合格件数は両方式とも2件で、OptimizerのOutputは直接実行に対して一括訂正で84%増、ネットワークで186%増だった。一括訂正の前回試行はResponses APIで、今回とは実行経路と検索の有無が異なる。 [今回の集計](../../artifacts/optimizer-codex-web-20261112/strict-compare/summary.json)

事前の試行ではOptimizerの仮説生成時に対象外の内蔵ツール呼び出しを検出したため、その試行を集計から除いた。両方式の内蔵ツールをライブWeb検索に揃えた上で、同じリクエストがJSONで応答することを確認してから比較を行った。 [事前試行](../../artifacts/optimizer-codex-web-20261112/run.log) · [再現結果](../../artifacts/optimizer-codex-web-20261112/strict-replay.json)

ネットワークの課題は直接実行で合格したため、定例比較から外した。 `network-parity` はWeb検索のないResponses APIでも合格した（11呼び出し、Input 34,818、Cached 0、Output 9,321）。 `network-versions` はWeb検索ありのCodexで合格した（10呼び出し、検索1回、Input 208,203、Cached 41,428、Output 14,557）。 [検索なしの対照](../../artifacts/optimizer-codex-web-20261112/plain-network/summary.json) · [分岐付きの直接実行](../../artifacts/optimizer-codex-web-20261112/versions-direct/summary.json)

`inventory-branches` の参照解は独立した72件の正しさ検査に合格し、未使用の5万操作を3分布で各7回正しく処理した。最長1.421秒だった。CodexのライブWeb検索ありの直接実行も合格し、最長1.826秒だった（8呼び出し、検索1回、Input 165,946、Cached 45,692、Output 8,510）。 [事前検証](../../artifacts/optimizer-codex-web-20261112/inventory-preflight.json) · [配送網の直接実行](../../artifacts/optimizer-codex-web-20261112/inventory-direct/summary.json)

検索なしのResponses APIでは、直接実行が正しさ検査で不合格となり、速度計測の前に部分終了した（15呼び出し、Input 58,573、Cached 0、Output 17,451）。最後に保存した未検証候補も、隔離環境での事後検査で12件中8件が不正解だった。この実行を理由に、配送網を比較対象に残す。 [検索なしの直接実行](../../artifacts/optimizer-codex-web-20261112/plain-inventory/summary.json) · [未検証候補の事後検査](../../artifacts/optimizer-codex-web-20261112/plain-inventory-last-candidate-sandbox.json)

同じResponses APIのOptimizerは9呼び出しで合格した（Input 51,279、Cached 10,914、Output 10,575）。提出版は未使用の5万操作の全21回で出力が一致し、最長1.971秒だった。配送網の各実行では同じ受入条件・データ・上限を使い、速度測定のばらつきは各起動時に校正した。 [検索なしのOptimizer](../../artifacts/optimizer-codex-web-20261112/plain-inventory-optimizer/summary.json)

ライブWeb検索ありのOptimizerも合格した（8呼び出し、検索1回、Input 156,792、Cached 13,762、Output 18,952）。提出版は未使用の全21回で出力が一致し、最長2.019秒だった。同じCodex条件の直接実行も合格し、Outputは8,510だった。検索ありと検索なしで実行経路も変わるため、検索単独の効果はこの比較では測っていない。 [検索ありのOptimizer](../../artifacts/optimizer-codex-web-20261112/inventory-optimizer/summary.json)
