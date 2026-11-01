# 改善計画書（2026-11-02）: 測って記録する段階に戻る

作成日: 2026-11-02
読む人: この計画を実行するエージェント（以下「実行者」）。上から順に読み、書かれた順に実行する。
根拠: 2026-11-02 のプロジェクト評価。要点は §1。

## 状態（実行者が更新する）

各フェーズを始めたら「実行中」、終えたら「済み」と、日付・コミットを書く。止まったら「中止」と理由を書く。

| フェーズ | 中身 | 環境 | 状態 | 日付 | コミット / メモ |
| --- | --- | --- | --- | --- | --- |
| 0 | 記録の整備（結果の正本に ablation-1 と hz11 を書く） | B | 未着手 | | 環境 B の記録が必要なため、環境 A では未着手のまま残す |
| 1 | hz11 で追求（E1R）と直接解法（D0）を Haiku で比べる | B | 中止 | 2026-11-02 | 環境 B なし（この Mac には bwrap・`/workspace`・非公開資料がない） |
| 2 | 判定層（d1）の寄与を測る（E3 と E1R） | A | 中止 | 2026-11-02 | LARM に届かない: `missing env var PURSUIT_LARM_ORIGIN`（`192.168.0.130:9810` へ ping / curl ともタイムアウト） |
| 3 | `engine.ts` を、振る舞いを変えずに分割する | A か B | 実行中 | 2026-11-02 | |
| 4 | π² 以外の主課題を 3 題足し、難しさを確かめる | A | 未着手 | | |
| 5 | 最終報告 | - | 未着手 | | |

---

## 1. なぜこの計画か（評価の要点）

- 設計・実装・試験の質は高い。`bun run verify` はすべて通る（2026-11-02、464 pass / 12 skip / 0 fail）。
- しかし研究の中心の問い「追求の構造は直接解法より役に立つか」に、肯定的な証拠がまだない。
  - ablation-1 では、hz10 の課題で追求も直接解法も 42/42 だった（`spec/long-horizon-11.md` の冒頭に一行だけある）。この結果は `spec/results.md`・README・`eval/results/PUBLISHED` のどれにも載っていない。
  - hz11（長い課題）は、10-22〜23 に修正を十数回重ねたが、結果の記録がない。
- 判定層（d1）の寄与もまだ確かめられていない。base-2 では E2 が最も悪く（11/13、止めすぎ）、その後の実験はすべて E3 に固定していて、d1 の有無だけを変えた比較がない。
- 改善の判断のほとんどを、π² の 1 題・各 10 回で下している。

そこで、この計画では**新しい仕組みを足さない**。先に記録を正し（フェーズ 0）、コードを凍結して測り（フェーズ 1・2）、測り終えてから整理（フェーズ 3）と課題の追加（フェーズ 4）をする。

**順番の理由:** 実行設定の識別値 `configId` には、コードの内容が含まれる（`eval/run-config.ts`）。フェーズ 3 の分割はコードを変えるので、`configId` が変わる。そのため、測定（フェーズ 1・2）を分割より先に済ませる。

---

## 2. 絶対の規則（すべてのフェーズに適用する）

違反しそうになったら、作業を止めて §10 の書式で報告する。

1. **計画にない変更をしない。** プロンプトの改善、新しいフラグ、policy の新しい版、ヒューリスティックの追加は、この計画の範囲外。
2. **測定中（フェーズ 1・2 の間）は、`src/`・`eval/`・`config/`・`standalone/`・`scripts/`・`package.json`・`bun.lock` を変えず、Bun も更新しない。** 変えてよいのは `spec/` と `README.md` だけ。実行設定の識別値 `configId` は、これらのファイルの中身（未コミットの変更も含む）、Bun の版、OS、フラグ（`--concurrency` を含む）から計算される（`eval/run-config.ts`、`eval/main.ts` の `execution`）。一つでも変わると別の実行として扱われ、記録済みの分を飛ばせなくなる。`--tasks` と `--repeat` は `configId` に含まれない。
3. **測定中に不具合を見つけても直さない。** 記録して止まり、報告する。
4. **結果を見てから、課題の文面・採点基準・policy の値・フラグを変えない。** 回数を足すのも、計画にある場合だけ。
5. **リポジトリは公開（PUBLIC）である。**
   - hz10・hz11・abl1 の実行結果（`runs.jsonl`・`summary.md`・`analysis.md`）は `PUBLISHED` に載せず、`git add -f` もしない。`runs.jsonl` には最終の答えや報告の全文が入っていて、隠した答えが漏れるおそれがある。
   - 非公開ディレクトリの**パスと中身**を、リポジトリのファイルに書かない（パスは報告にだけ書く）。
6. **API の費用の上限を守る。** 各フェーズの上限は §9。上限は計器の `spend.limitUsd` でも機械的に止める（手順に書いてある）。
7. **サーバーを起動・停止・再起動しない**（コーパスサーバー、LARM を含む）。必要になったら止まって、利用者に頼む。
8. **取り消せない操作をしない。** `git reset`・`git checkout -- <file>`・`git rebase`・`git push --force`・履歴の書き換え、`eval/results/` の削除、非公開ディレクトリの変更、ほかのプロセスの停止はすべて禁止。
9. **コミット:** 各フェーズの終わりに、そのフェーズの変更だけをコミットして push する。新しい測定の前に、結果を含めてすべてを push 済みにする、というこのプロジェクトの決まりに従う。メッセージは英語で、既存の書き方（`git log --oneline` を見る）に合わせる。
10. **秘密を表示しない。** `.env` の中身や `LARM_API_TOKEN` の値は出力しない。あるかどうかだけを確かめる（手順に書いてある）。

---

## 3. 用語と前提

| 用語 | 意味 |
| --- | --- |
| 環境 A | 利用者の Mac。LARM（`http://192.168.0.130:9810`）に届く。Claude API の鍵と設定の DB（`data/pursuit-settings.sqlite`）がある。群 A〜E の課題を実行できる。bubblewrap がないので、hz10e・hz11 の作業領域の課題は実行できない。 |
| 環境 B | Linux の作業機（`/workspace` がある）。bubblewrap（`/usr/bin/bwrap`）、hz10・hz11 の非公開資料、過去の ablation-1・hz11 の実行結果がある。 |
| `<REPO>` | その環境での、このリポジトリの場所。環境 A は `/Users/y.noguchi/Code/eumenes_pursuit`。環境 B は実行者が確かめる。 |
| 計器 | `bun standalone/cli.ts spend` が出す API の支出（環境ごとの設定 DB に残る）。2026-11-02 の環境 A の値は **$38.854 / 上限 $90**。 |
| 正しく完了 | `outcome === "completed"` かつ `verified === true`（ホストの照合が通った完了）。 |
| 一次の指標 | 結論を出すために、事前に決めておく一つの数。このフェーズの結論は、これだけで書く。 |

コマンドは、特に書かない限り `<REPO>` で実行する。

---

## 4. フェーズ 0: 記録の整備（環境 B、費用 $0）

**目的:** すでにある結果を、結果の正本（`spec/results.md`）と README に正しく書く。新しい測定はしない。

### 前提の確認

```sh
cd <REPO>
git status --short          # 何も出ないこと（出たら止まって報告）
git fetch && git status -sb # main...origin/main で、behind がないこと（あれば git pull --ff-only）
git log -1 --format=%H      # 報告に書く
```

### 手順

**0-1. 土台の確認**

```sh
bun install
bun run verify
bun run build
```

`verify` の最後に `OK: deterministic checks.`、`bun test` の行に `0 fail` が出ること。pass / skip の数を報告に書く。失敗したら止まって報告する（直さない）。

**0-2. ablation-1 の実行結果を探す**

```sh
ls -d eval/results/abl1-* 2>/dev/null
ls -d /workspace/pursuit_abl/* 2>/dev/null
```

- 想定している名前は `abl1-pursuit-r1`〜`r3` と `abl1-direct-r1`〜`r3`（`-tight` が付くものもあるかもしれない）。
- 見つからないときは、`find / -type d -name 'abl1-*' -path '*eval/results*' 2>/dev/null | head` を一度だけ試す。
- それでもなければ、0-4 は「所在不明」の書式で書く。

**0-3. ablation-1 の比較表を作る**（見つかった run 名をすべて並べる。`-tight` は別の行にする）

```sh
bun eval/analyze.ts --compare abl1-pursuit-r1 abl1-pursuit-r2 abl1-pursuit-r3 abl1-direct-r1 abl1-direct-r2 abl1-direct-r3 > /tmp/abl1-compare.md
cat /tmp/abl1-compare.md
```

応答者が何だったかを確かめる。`runs.jsonl` の `generator` に `/LLM-file` があればファイル経由の応答者。`fileResponderId` などのモデルの記録があれば、それも見る。

```sh
grep -h -o '"generator":"[^"]*"' eval/results/abl1-*/runs.jsonl | sort | uniq -c
grep -h -o '"fileResponderId":"[^"]*"' eval/results/abl1-*/runs.jsonl | sort | uniq -c
```

**0-4. `spec/results.md` の末尾に ablation-1 の節を足す**

下の書式で書く。`【 】` の部分は、0-3 の出力で置き換える。数字は表から写し、本文の数字と表の数字が合わないときは表を正とする。

```markdown
## ablation-1: 追求と直接解法（2026-10-22）

構成: 追求は E1R（`--findings verified --self-check parts --verify-on claim --prediction falsifiable --completion-check acceptance --claim-feedback verdict --attempt-count mutating`）、直接解法は D0（`eval/direct.ts`）。同じ課題・道具・照合・採点。policy v5（【tight の回があれば v5-tight も】）。horizon-10 の【課題数】課題 × 各【回数】回。応答者は【ファイル経由の応答者（モデル名: 記録があれば書く／なければ「記録なし」）】で、API の Haiku ではない。実行は環境 B（記録は手元だけ。公開しない。理由は隠した答えを守るため）。

【/tmp/abl1-compare.md の最初の表（群 × 方式 × 予算）をそのまま貼る】

所見:

1. 正しい結末は、追求【a/n】、直接解法【b/n】で、差はなかった。
2. 直接解法の道具の呼び出しは、最大【m】回（中央【x】回）。課題が短く、構造の差が出る長さではなかった。
3. 応答者は強いモデルで、目標の設定（弱いモデルで続ける）とも違う。
4. したがって、今のところ「追求の構造が直接解法より良い」という証拠はない。長い課題（hz11）と Haiku での比較を、改善計画書（2026-11-02）のフェーズ 1 で行う。
```

所在不明のときは、表の代わりに「記録の所在不明。`spec/long-horizon-11.md` の冒頭の記述（42/42 で同点、D0 の道具の呼び出しは最大 12 回）だけが残っている」と書き、所見の 1・2 はその数字で書く。

**0-5. hz11 の状態の節を足す**

```sh
ls -d eval/results/hz11* 2>/dev/null
```

見つかった run ごとに、`bun eval/main.ts report --name <run> | head -20` で件数と結末を見る。そのうえで、下の書式で `spec/results.md` の末尾に足す。

```markdown
## horizon-11: 長い課題（実装済み、比較の測定は未実施）

- 課題は 5 題（`spec/long-horizon-11.md`）。policy は v6-long（試行 200・壁時計 120 分・手順 1500・方針 8・一段上へ 40）。
- 10-22〜23 に、試走で見つかった問題を修正した（コミットの hz11f〜hz11m、`spec/fixes-2026-10-22-*.md`）。
- 試走の記録: 【run 名と、件数・結末の一行要約。なければ「手元に記録なし」】。試走のたびにコードが違うので、比較には使わない。
- 追求と直接解法の比較は、改善計画書（2026-11-02）のフェーズ 1 で行う。
```

**0-6. README を直す**（Edit で、正確な文字列を置き換える）

(a) 「## 到達点（2026-10-21）」節の最後の段落、つまり「照合の一部（証明の採点）は、強いモデル（Sonnet 5.5）による判定で、」で始まる段落の**直後**に、次を足す。数字は 0-4 と同じものにする。

```markdown
### 構造の付加価値（ablation-1、2026-10-22）

同じ課題・道具・照合で、追求の構造（E1R）と直接解法（D0）を比べた。horizon-10 の課題では、どちらも【a/n】と【b/n】で差がなかった。直接解法が使った道具の呼び出しは最大【m】回で、課題が短すぎて差が出なかった。応答者はファイル経由の強いモデルで、Haiku ではない。したがって、今のところ「追求の構造が直接解法より良い」という証拠はない。長い課題と Haiku での比較は [改善計画書（2026-11-02）](spec/improvement-plan-2026-11-02.md) で行う。
```

(b) 「想定の使い方に向けた進捗」の表で、次の行を置き換える。

- 置き換える前: `| 長い予算で前に進み続ける（一晩の模擬） | 設計のみ（horizon-1 は未実施） |`
- 置き換えた後: `| 長い予算で前に進み続ける（一晩の模擬） | 長い課題 hz11（試行 200・120 分）を実装済み。Haiku での測定は未実施 |`

その行の**直後**に、次の行を足す。

`| 追求の構造の付加価値（直接解法との比較） | hz10 では差なし（強い応答者）。hz11・Haiku では未測定 |`

**0-7. 手元の絶対パスへのリンクを外す**

`spec/improvement-plan-2026-10-22.md` の 30 行目（「追加評価の [詳細報告](/Users/…」で始まる行）を、次の 1 行に置き換える。

```markdown
追加評価の詳細報告と再現試験（開発者の手元の資料。リポジトリの外にあり、ここからは辿れない）が根拠である。再現試験は現在の不具合を確認するものであり、実装時には期待値を「修正後の正しい動作」にした正式な回帰試験へ移す。評価資料は開発者のローカル保存であるため、移植する試験はリポジトリ内で単独実行できるようにする。
```

**0-8. 引継ぎの検証の状態を書く**

`spec/improvement-implementation-2026-10-22.md` の末尾に、次の書式で足す。項目 1〜7 は、同じファイルの「grok botへの検証引継ぎ」の番号。

```markdown
## 引継ぎの検証の状態（【実行日】）

| 項目 | 状態 | 根拠 |
| --- | --- | --- |
| 1 | 【済み／未実施／未確認】 | 【試験ファイル・コミット・実行ログ。なければ空欄】 |
| … | | |
| 7 | 済み | フェーズ 0 の 0-1（`bun run verify`: 【pass/skip/fail】、`bun run build` 成功） |
```

実行者が実際に確かめたものだけを「済み」にする。覚えていないもの、根拠を示せないものは「未確認」にする。この計画では、項目 1〜6 の検証はしない。

**0-9. 確認とコミット**

```sh
bun run verify
git add spec/results.md README.md spec/improvement-plan-2026-10-22.md spec/improvement-implementation-2026-10-22.md spec/improvement-plan-2026-11-02.md
git status --short   # 上の 5 ファイル以外が出ないこと。eval/results/ が出たら止まる
git commit -m "records: ablation-1 result and horizon-11 status in results.md and README (plan 2026-11-02 §0)"
git push
```

### 完了の条件

- [ ] `spec/results.md` に、ablation-1 と horizon-11 の節がある。
- [ ] README に、構造の付加価値の小節と、進捗の表の 2 行がある。
- [ ] `spec/improvement-plan-2026-10-22.md` に `/Users/` が残っていない（`grep -c '/Users/' spec/improvement-plan-2026-10-22.md` が 0）。
- [ ] `bun run verify` が通る。
- [ ] `git status --short` が空で、push 済み。

---

## 5. フェーズ 1: hz11 で追求と直接解法を Haiku で比べる（環境 B、上限 $25）

**目的:** 長い課題で、追求の構造（E1R）が直接解法（D0）より結果をよくするかを、目標の設定（安いモデル Haiku 5.5）で測る。

**一次の指標:** 正しく完了の数（条件ごと、4 課題 × 回数）。

**二次の指標:** 隠れた検査の通過率（`hiddenPassed / hiddenTotal` の平均。部分的な進み）、偽の完了、止めすぎ、申告の不合格 / 全体、道具の呼び出し、応答の要求、費用。二次の指標は記述するだけにし、結論には使わない。

**対象の課題:** `hz11-legacy-billing`、`hz11-black-box`、`hz11-messy-ledger`、`hz11-sales-pipeline`。

`hz11-water-ratio` は外す。理由は二つある。コーパスサーバーの起動が要る（§2 の 7）ことと、採点が Sonnet によるモデルの採点で、費用がかかり機械検査でもないこと。

### 前提の確認（一つでも満たさなければ止まって報告する）

```sh
cd <REPO>
git status --short && git fetch && git status -sb   # 空で、origin/main と同じ
git log -1 --format=%H                              # これを FREEZE として「状態」の表と報告に書く
test -x /usr/bin/bwrap && echo bwrap-ok
grep -c '^ANTHROPIC_API_KEY=' .env; test -n "$ANTHROPIC_API_KEY" && echo env-key-set   # どちらかで鍵があること（値は表示しない）
bun standalone/cli.ts settings show | grep -E '"(llm.generator|llm.reviewer)"' -A2
```

`llm.generator` と `llm.reviewer` の model が、どちらも `claude-haiku-5-5` であること。違えば止まる（設定を自分で変えない）。

**非公開資料の場所を、過去の hz11 の実行から写す:**

```sh
ls -t /workspace/*/READY.txt /workspace/*/*/READY.txt 2>/dev/null | head
grep -h -o -E -- '--(secret-dir|private-data-version|claim-limit|claim-evidence) [^ ]+' $(ls -t /workspace/*/READY.txt /workspace/*/*/READY.txt 2>/dev/null) | head -20
```

hz11 の課題を含む、いちばん新しい READY.txt から、次の値を写す。

- `SECRET_DIR`（`--secret-dir` の値）
- `PDV`（`--private-data-version` の値）
- `--claim-limit` と `--claim-evidence`（既定と違う値が書かれているときだけ）

見つからない、または hz11 の課題を含む READY.txt がないときは、止まって利用者に聞く。値は報告にだけ書き、リポジトリには書かない。

**費用の上限を設定する:**

```sh
bun standalone/cli.ts spend                      # B_NOW = spent の値。報告に書く
bun standalone/cli.ts settings show | grep limitUsd   # 元の上限。報告に書き、フェーズの最後に戻す
```

- 環境 A の計器（$38.854）と B_NOW の和に 33（フェーズ 1・2・4 の上限の合計）を足して、90 を超えるときは止まって聞く。
- 超えないときは、B の上限を `B_NOW + 25` にする。下の例は B_NOW が 1.20 のとき。

```sh
bun standalone/cli.ts settings set spend.limitUsd 26.20
```

### 実行の設定（事前に固定する。途中で変えない）

シェルの変数に入れる。2 回目以降も必ず同じ値を使う（§2 の 2: フラグが一つでも変わると `configId` が変わる。`--concurrency` も含む）。

```sh
SECRET_DIR=<写した値>
PDV=<写した値>
EXTRA=""   # READY.txt に既定と違う --claim-limit / --claim-evidence があれば、ここに同じ形で入れる
TASKS=hz11-legacy-billing,hz11-black-box,hz11-messy-ledger,hz11-sales-pipeline
COMMON="--policy config/policy.v6-long.json --max-steps 2000 --tools 0 --concurrency 2 --secret-dir $SECRET_DIR --private-data-version $PDV --claim-feedback verdict $EXTRA"
PURSUIT="--conditions E1R --findings verified --self-check parts --verify-on claim --prediction falsifiable --completion-check acceptance --attempt-count mutating --rollback keep --verdict-label refutation"
DIRECT="--conditions D0"
```

### 手順

**1-1. 下見（1 課題 × 2 条件 × 1 回、上限 $3）**

```sh
bun eval/main.ts run --name hz11h-pilot $COMMON $PURSUIT --tasks hz11-messy-ledger --repeat 1 2>&1 | tee -a eval/results/hz11h-pilot.log
bun eval/main.ts run --name hz11h-pilot $COMMON $DIRECT  --tasks hz11-messy-ledger --repeat 1 2>&1 | tee -a eval/results/hz11h-pilot.log
bun standalone/cli.ts spend
```

ログの `[done] … $x.xxxx …s` の行から、条件ごとの費用（`c_E`・`c_D`）と時間を報告に書く。下見の結果は分析に使わない。

- `[done]` の行に `error` が出た、または終わり方が「誤り」のとき → 同じコマンドをもう一度だけ実行する（記録済みの分は飛ばされ、誤りの分だけやり直される）。また誤りなら止まって報告する。
- 道具の拒否（例: `bwrap` の起動失敗）が出たとき → 止まって報告する。

**1-2. 回数を決める**

見込み = `4 課題 × R 回 × (c_E + c_D) × 1.5`（1.5 は、ほかの課題が長いかもしれない分の余裕）。

- R = 3 で見込みが $22 以下 → **R = 3**。
- そうでなく、R = 2 で $22 以下 → **R = 2**。
- どちらも超える → 止まって、`c_E`・`c_D`・見込みを報告する。

**1-3. 本番（回ごとに両方の条件を回す）**

r = 1 から R まで、次の 2 行を順に実行する。`--repeat r` は、r 回目までを回し、記録済みの回は飛ばす。

```sh
bun eval/main.ts run --name hz11h-e1r $COMMON $PURSUIT --tasks $TASKS --repeat <r> 2>&1 | tee -a eval/results/hz11h-e1r.log
bun eval/main.ts run --name hz11h-d0  $COMMON $DIRECT  --tasks $TASKS --repeat <r> 2>&1 | tee -a eval/results/hz11h-d0.log
bun standalone/cli.ts spend
```

r = 2 以降の実行では、ログの最初の行 `jobs: N (skipping M already recorded)` の **N が 4** であることを確かめる（前の回に誤りの記録が残っていれば、その件数だけ多くてよい）。N が 8 や 12 なら、前の回の分が飛ばされていない。つまりフラグか環境が変わっている。すぐに Ctrl-C で止めて報告する（M は run 全体の記録数なので、判断には使わない）。

各 r のあとに確かめること:

- （計器の値 − B_NOW）が、`3 + r × (見込み ÷ R)` を超えていたら、次の r に進まずに止まって報告する。見込みには、1-2 の 1.5 倍の余裕がすでに入っている。
- 誤りの記録が 2 件以上ある → 同じ 2 行をもう一度実行する。それでも誤りが残れば止まって報告する。
- `429`（rate limit）による誤りが続くとき → `--concurrency` を変えずに（変えると `configId` が変わる）、止まって報告する。
- `spend_limit_reached` で止まった → 上限に達した。上限を上げずに、止まって報告する。

**1-4. 集計**

```sh
bun eval/main.ts report --name hz11h-e1r > /dev/null
bun eval/main.ts report --name hz11h-d0 > /dev/null
bun eval/analyze.ts --compare hz11h-e1r hz11h-d0 > /tmp/hz11h-compare.md
```

次の内容を `/tmp/tally.sh` に作る（リポジトリには入れない）。使い方は `bash /tmp/tally.sh <run> [<run> …]`。

```sh
RUNS="$*" bun -e '
const fs = require("fs");
const rows = new Map();
for (const run of process.env.RUNS.split(" ").filter(Boolean)) {
  const path = `eval/results/${run}/runs.jsonl`;
  for (const line of fs.readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    rows.set(`${run}|${r.task}|${r.condition}|${r.generator}|${r.repeat}`, r);
  }
}
const by = new Map();
for (const r of rows.values()) by.set(r.condition, [...(by.get(r.condition) ?? []), r]);
console.log("| 条件 | n | 正しく完了 | 隠れた検査の通過率(平均) | 偽の完了 | 誤り | 費用(合計) |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const [c, rs] of [...by].sort()) {
  const ok = rs.filter((r) => r.outcome === "completed" && r.verified).length;
  const h = rs.filter((r) => typeof r.hiddenTotal === "number" && r.hiddenTotal > 0);
  const frac = h.length ? (h.reduce((s, r) => s + r.hiddenPassed / r.hiddenTotal, 0) / h.length).toFixed(3) : "-";
  const usd = rs.reduce((s, r) => s + (r.usd ?? 0), 0).toFixed(2);
  console.log(`| ${c} | ${rs.length} | ${ok}/${rs.length} | ${frac} | ${rs.filter((r) => r.falseCompletion).length} | ${rs.filter((r) => r.error).length} | $${usd} |`);
}'
```

次の内容を `/tmp/fisher.sh` に作る（リポジトリには入れない）。使い方は `bash /tmp/fisher.sh <E側の成功> <E側の失敗> <対照の成功> <対照の失敗>`。たとえば 8/10 と 1/10 なら `bash /tmp/fisher.sh 8 2 1 9` で、`p = 0.0055` が出れば正しく作れている。

```sh
A=$1 B=$2 C=$3 D=$4 bun -e '
const [a,b,c,d]=["A","B","C","D"].map(k=>Number(process.env[k]));
const lf=n=>{let s=0;for(let i=2;i<=n;i++)s+=Math.log(i);return s};
const r1=a+b,r2=c+d,c1=a+c,n=r1+r2;
const p=x=>Math.exp(lf(r1)+lf(r2)+lf(c1)+lf(n-c1)-lf(n)-lf(x)-lf(r1-x)-lf(c1-x)-lf(r2-c1+x));
const p0=p(a);let s=0;
for(let x=Math.max(0,c1-r2);x<=Math.min(r1,c1);x++){const q=p(x);if(q<=p0*(1+1e-9))s+=q}
console.log(`E側 ${a}/${r1}  対照側 ${c}/${r2}  Fisher 両側 p = ${s.toFixed(4)}`)'
```

```sh
bash /tmp/tally.sh hz11h-e1r hz11h-d0
bash /tmp/fisher.sh <E1Rの成功> <E1Rの失敗> <D0の成功> <D0の失敗>
```

**1-5. 結論の書き方（事前に決めた規則。この中から一つだけを選ぶ）**

| 当てはまる結果 | 結論として書く文 |
| --- | --- |
| 両方とも正しく完了が 0、かつ隠れた検査の通過率が両方とも 0.1 未満 | 「床に張り付いた。hz11 は Haiku には難しすぎ、構造の差は測れない」 |
| Fisher の p < 0.05 | 「【E1R／D0】が多く解いた（a/n 対 b/n、p = …）」 |
| それ以外 | 「n = … では差は見えない（a/n 対 b/n、p = …）」。二次の指標は表で示すだけにする |

どの場合も、課題を易しくしたり、回数を足したりしない。次の手は、利用者が決める。

**1-6. 記録**

`spec/results.md` の末尾に、次の書式で足す。

```markdown
## hz11h: 長い課題で追求と直接解法（Haiku 5.5、【実行日】）

構成: 生成層・振り返りは Claude Haiku 5.5（API）。policy v6-long、`--max-steps 2000`。課題 4 題（hz11-legacy-billing・black-box・messy-ledger・sales-pipeline）× 各【R】回。追求は E1R（【PURSUIT の値をそのまま】）、直接解法は D0。共通: `--claim-feedback verdict`【EXTRA があれば】。コードは【FREEZE の短い hash】。hz11-water-ratio は外した（コーパスサーバーとモデル採点が要るため）。実行は環境 B。記録は手元だけ（公開しない）。

【bash /tmp/tally.sh の表】

【/tmp/hz11h-compare.md の最初の表】

一次の指標（正しく完了）: E1R【a/n】、D0【b/n】、Fisher 両側 p = 【…】。

結論: 【1-5 の表で選んだ文】

費用: このフェーズで $【…】（環境 B の計器: 【前】→【後】）。
```

**1-7. 片付けとコミット**

```sh
bun standalone/cli.ts settings set spend.limitUsd <元の上限>
git add spec/results.md spec/improvement-plan-2026-11-02.md
git status --short     # この 2 ファイルだけ
git commit -m "hz11h: pursuit (E1R) vs direct (D0) on Haiku 5.5, results (plan 2026-11-02 §1)"
git push
```

### 完了の条件

- [ ] `hz11h-e1r` と `hz11h-d0` に、4 課題 × R 回ずつ、誤りのない記録がある。
- [ ] `spec/results.md` に hz11h の節があり、結論が 1-5 の 3 つの文のどれか一つになっている。
- [ ] hz11h の結果は、`PUBLISHED` にも git の索引にも入っていない（`git ls-files eval/results | grep hz11h` が空）。
- [ ] 上限を元に戻し、push 済み。

---

## 6. フェーズ 2: 判定層（d1）の寄与を測る（環境 A、上限 $5）

**目的:** 判定層（LARM の d1）が、結果を良くしているかを確かめる。E3 と E1R の違いは、判定層の有無だけ。

**一次の指標:** π² の正しく完了の数（E3 と E1R、各 10 回）。

**二次の指標:** 群 A で正しく止まった数（各 3 題 × 2 回）、申告の不合格、一段上へ、相談、判定器の失敗、費用。

### 前提の確認（一つでも満たさなければ止まる。LARM に届かないときは §6 の最後の「届かないとき」へ）

```sh
cd /Users/y.noguchi/Code/eumenes_pursuit
git status --short && git pull --ff-only && git log -1 --format=%H
git diff --stat <FREEZE> HEAD -- src eval config standalone scripts   # 何も出ないこと（フェーズ 0・1 は spec と README しか変えていないはず）
test -n "$LARM_API_TOKEN" && echo token-set
PURSUIT_LIVE=1 bun test standalone/larm/test/live.test.ts             # LARM への接続を確保して解放するだけの試験。pass であること
bun standalone/cli.ts spend                                           # A_NOW。報告に書く
bun standalone/cli.ts settings show | grep -E 'limitUsd|"llm.(generator|reviewer|grader)"' -A2
```

- generator と reviewer は `claude-haiku-5-5`、grader は `claude-sonnet-5-5` であること。
- 上限を `A_NOW + 5` に設定する: `bun standalone/cli.ts settings set spend.limitUsd <A_NOW + 5>`。

### 実行の設定（固定）

completion-1 の acceptance の腕と同じフラグにする。ただし、10-21 以降に変わった既定値（`--rollback notify`、`--verdict-label refutation`）は、両方の腕に同じように入る。**そのため、completion-1 の数字とは比べず、この実行の中の 2 つの腕どうしでだけ比べる。**

```sh
BASE="--policy config/policy.v3.json --tools 0 --findings verified --self-check parts --verify-on claim --prediction falsifiable --completion-check acceptance"
```

### 手順

**2-1. π²（各 10 回）**

```sh
bun eval/main.ts run --name d1-pi2 --conditions E3,E1R --tasks e4-pi-squared-irrational --repeat 10 $BASE --concurrency 3 2>&1 | tee -a eval/results/d1-pi2.log
bun standalone/cli.ts spend
```

**2-2. 群 A（各 3 題 × 2 回）**

```sh
bun eval/main.ts run --name d1-a --conditions E3,E1R --tasks a-missing-budget,a-stale-supplier-price,a-contradictory-room --repeat 2 $BASE --concurrency 3 2>&1 | tee -a eval/results/d1-a.log
bun standalone/cli.ts spend
```

誤りと上限の扱いは、フェーズ 1 の 1-3 と同じ（同じコマンドを一度だけやり直す。だめなら止まる）。

**2-3. 集計**

```sh
bun eval/main.ts report --name d1-pi2
bun eval/main.ts report --name d1-a
bash /tmp/tally.sh d1-pi2       # /tmp/tally.sh と /tmp/fisher.sh は、フェーズ 1 の 1-4 と同じ内容で、この環境にも作る
bash /tmp/fisher.sh <E3の成功> <E3の失敗> <E1Rの成功> <E1Rの失敗>
bun eval/analyze.ts d1-pi2 --strategies --merge-configs > eval/results/d1-pi2/analysis.md
bun eval/analyze.ts d1-a --strategies --merge-configs > eval/results/d1-a/analysis.md
```

群 A の結果は、`eval/results/d1-a/summary.md` の「正しい結末」の列を使う（正しく止まることも「正しい」に数えるため、tally の「正しく完了」は使わない）。

`--merge-configs` は、この 2 つの run には 2 つの条件（= 2 つの configId）があるので付ける。analyze がエラーになったら、エラーの文をそのまま報告に書き、analysis.md は作らずに先へ進む。

**2-4. 結論の書き方（一つだけを選ぶ）**

| 当てはまる結果 | 結論として書く文 |
| --- | --- |
| π² で Fisher の p < 0.05、かつ E3 が多い | 「判定層は π² の通過を上げた（a/10 対 b/10、p = …）」 |
| π² で Fisher の p < 0.05、かつ E1R が多い | 「判定層を除いたほうが π² をよく解いた（a/10 対 b/10、p = …）。判定層が害になっている可能性がある」 |
| それ以外 | 「判定層の上積みは見えない（π² a/10 対 b/10、p = …）」 |

群 A で、どちらかの腕の正しい結末が 6/6 を下回ったら、結論の文の後ろに「群 A で【腕】が【x/6】（止め方の誤り）」と足す。

取り込みの範囲を変えるかどうかは、利用者が決める。実行者はここで提案を書かない。

**2-5. 記録と公開**

この 2 つの run は、群 E と群 A の課題で隠した答えを含まないので、これまでの math・completion の回と同じように公開する。

```sh
printf 'd1-pi2\nd1-a\n' >> eval/results/PUBLISHED
git add -f eval/results/d1-pi2/runs.jsonl eval/results/d1-pi2/summary.md eval/results/d1-a/runs.jsonl eval/results/d1-a/summary.md
git add -f eval/results/d1-pi2/analysis.md eval/results/d1-a/analysis.md 2>/dev/null   # 作れた場合だけ
```

`spec/results.md` の末尾に、次の書式で足す。

```markdown
## d1-1: 判定層の寄与（E3 と E1R、【実行日】）

構成: 生成層・振り返り Haiku 5.5、採点 Sonnet 5.5、d1 は本番 LARM（`decision.general`、基本モデル、日本語の基準）。【BASE の値】。既定の `--rollback notify` と `--verdict-label refutation` は両腕に同じく入る。completion-1 とは既定値が違うので、数字を直接比べない。コードは【FREEZE】。

| 腕 | π² 正しく完了 | 群 A 正しい結末 | 申告 不合格/全 | 一段上へ | 相談 | 判定器の失敗 | 費用 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E3（判定層あり） | 【a/10】 | 【x/6】 | | | | | |
| E1R（判定層なし） | 【b/10】 | 【y/6】 | | | | （該当なし） | |

Fisher 両側 p = 【…】。

結論: 【2-4 の表で選んだ文】
```

**2-6. 片付けとコミット**

```sh
bun standalone/cli.ts settings set spend.limitUsd <元の上限>
bun run verify      # check:results が通ること（PUBLISHED の名前と git add -f したファイルが合っていること）
git add spec/results.md spec/improvement-plan-2026-11-02.md eval/results/PUBLISHED
git status --short
git commit -m "d1-1: judge contribution, E3 vs E1R on pi^2 and group A (plan 2026-11-02 §2)"
git push
```

### LARM に届かないとき

`live.test.ts` が失敗した、または `LARM_API_TOKEN` がないときは、フェーズ 2 を「中止（LARM に届かない: 【エラーの 1 行目】）」とし、`spec/results.md` には何も書かずにフェーズ 3 へ進む。LARM を起動・再起動しようとしない。

### 完了の条件

- [ ] `d1-pi2` に E3・E1R 各 10 件、`d1-a` に E3・E1R 各 6 件の、誤りのない記録がある。
- [ ] `spec/results.md` に d1-1 の節があり、結論が 2-4 の 3 つの文のどれかになっている。
- [ ] `bun run verify` が通り、push 済み。上限を元に戻した。

---

## 7. フェーズ 3: `engine.ts` を、振る舞いを変えずに分割する（費用 $0）

**目的:** `src/domains/loop/engine.ts`（2142 行。`createPursuitEngine` の一つのクロージャの中に、`propose` 約 360 行・`review` 約 470 行がある）を、読める大きさに分ける。**振る舞い（LLM に送る文面、台帳への書き込み、判断）は 1 文字も変えない。**

**前提:** フェーズ 1・2 が「済み」か「中止」になり、push 済みであること（分割すると `configId` が変わるため）。

### 守り方: 黄金の記録（golden snapshot）

シナリオ試験（`test/scenario/*.test.ts`）の多くは、`test/scenario/harness.ts` の `run()` を通る。この `run()` は、時計と ID を数で決めていて、毎回同じ結果になる。`run()` が返す「LLM に送った全文面」と「最後の台帳の姿」を snapshot に取り、分割の前後で一致することを確かめる。

2026-11-02 に、リポジトリの写しでこの方法を試した。結果は次のとおり。

- 10 ファイル中 8 ファイル、41 件の snapshot（約 1.4MB）ができた。3 回続けて実行しても一致した。
- `engine.test.ts` などは `run()` を使わないので snapshot はできないが、普段どおり試験として走る。
- 環境変数を付けない普段の `bun test`、型、整形、lint は通った。
- プロンプトの 1 文字を変えると 32 件が落ち、変更を検出できた。

**3-1. snapshot を取る仕組みを足す**

`test/scenario/harness.ts` を、次のように 2 か所だけ変える。

(a) import の先頭に、次を足す。

```ts
import { expect } from "bun:test";
```

(b) `run()` の最後の行、

```ts
	return { view: (await engine.view(pursuitId))!, prompts };
```

を、次に置き換える。

```ts
	const view = (await engine.view(pursuitId))!;
	if (process.env.PURSUIT_GOLDEN === "1")
		expect({ prompts, view }).toMatchSnapshot();
	return { view, prompts };
```

**3-2. 分割の前の snapshot を作り、二度目も一致することを確かめる**

```sh
PURSUIT_GOLDEN=1 bun test test/scenario --update-snapshots
PURSUIT_GOLDEN=1 bun test test/scenario      # 0 fail であること（毎回同じ結果になることの確認）
PURSUIT_GOLDEN=1 bun test test/scenario      # もう一度。0 fail であること
bun run verify
```

- 二度目か三度目で snapshot が合わない試験があれば、時刻や一時ディレクトリなど、毎回変わる値が入っている。その試験の名前を報告して止まる（ほかの仕組みで回避しない）。
- `test/scenario/__snapshots__/` ができていることを確かめる。

```sh
git add test/scenario/harness.ts test/scenario/__snapshots__
git commit -m "test: golden snapshots of scenario prompts and ledger views (PURSUIT_GOLDEN=1, plan 2026-11-02 §3)"
```

**3-3. 分割の形**

| 新しいファイル（`src/domains/loop/`） | 中身 | 元の場所（2026-11-02 の行番号） |
| --- | --- | --- |
| `helpers.ts` | クロージャの外にある純粋な関数と定数: `trajectoryStreak`、`damageSignals`、`damaging`、`hypothesisHeld`、`decidedByLabel`、`budgetReasons`、`noChanges`、`normalPath`、`reviewKinds`、`citationNote`、`findingRefs`、`sentenceClip` | 132〜224、2094〜末尾 |
| `context.ts` | `makeBase(deps)`（`deps`・`store`・`clock`・`ids`・`warn`・`read`・`result`・`inference`・`llmRow`・`call`・`checkTime` を返す）と、型 `EngineBase`・`EngineHelpers`・`EngineSteps`・`EngineCtx` | 227〜289 |
| `support.ts` | 葉の関数（エンジンの段の関数を呼ばないもの）: `askJudge`、`recordFindings`、`recordDeadEnd`、`checkedFindings`、`writeJudgements`、`featuresOf`、`changingTools`、`firedSignals`、`reject` | 291〜562、867〜898 |
| `transitions.ts` | `finish`、`stepBack`、`consult`、`plan`、`hypothesize` | 563〜866 |
| `propose.ts` | `propose` | 899〜1260 |
| `attempt.ts` | `attempt`、`resumeSettlement` | 1261〜1632 |
| `review.ts` | `review` | 1633〜1937 |
| `engine.ts`（残す） | 型 `PursuitRuntime`・`EngineDeps`・`PursuitEngine`、`createPursuitEngine`（組み立てと `start`・`step`・`answer`・`cancel`・`view`）、`export { citationNote } from "./helpers.ts";` | 89〜131、226、1938〜2093 |

行番号は目安。関数の名前で探す（`grep -n 'function 名前' src/domains/loop/engine.ts`）。

**3-4. 型と組み立て（この形にする）**

`context.ts`:

```ts
import type { EngineDeps } from "./engine.ts";
import type { makeSupport } from "./support.ts";
// ほかに要る型は、engine.ts の import から写す

export function makeBase(deps: EngineDeps) {
	const { store, clock, ids } = deps;
	const warn = /* engine.ts の warn をそのまま */;
	async function read(/* そのまま */) { /* そのまま */ }
	function result(/* そのまま */) { /* そのまま */ }
	function inference(/* そのまま */) { /* そのまま */ }
	const llmRow = /* そのまま */;
	async function call</* そのまま */>(/* そのまま */) { /* そのまま */ }
	function checkTime(/* そのまま */) { /* そのまま */ }
	return { deps, store, clock, ids, warn, read, result, inference, llmRow, call, checkTime };
}
export type EngineBase = ReturnType<typeof makeBase>;
export type EngineHelpers = EngineBase & ReturnType<typeof makeSupport>;

/** 段の関数。互いに呼び合うので、型を明示する（推論させると循環して tsc が失敗する）。引数は engine.ts の宣言をそのまま写す。 */
export interface EngineSteps {
	finish(view: PursuitView, runtime: PursuitRuntime, outcome: Report["outcome"], reason: string, decidedBy: DecidedBy, signal: AbortSignal, known?: readonly CriterionResult[], basisExtra?: JsonObject): Promise<StepResult>;
	stepBack(view: PursuitView, reason: string, decidedBy: DecidedBy, basis: JsonObject): Promise<StepResult>;
	consult(view: PursuitView, question: string, missing: string, decidedBy: DecidedBy, extra?: (db: LedgerDb) => void, basisExtra?: JsonObject): Promise<StepResult>;
	plan(view: PursuitView, runtime: PursuitRuntime, signal: AbortSignal): Promise<StepResult>;
	hypothesize(view: PursuitView, runtime: PursuitRuntime, signal: AbortSignal): Promise<StepResult>;
	propose(view: PursuitView, runtime: PursuitRuntime, signal: AbortSignal): Promise<StepResult>;
	attempt(view: PursuitView, runtime: PursuitRuntime, p: Proposal, usage: InferenceRow, tools: readonly ToolDescriptor[], signal: AbortSignal): Promise<StepResult>;
	resumeSettlement(view: PursuitView, runtime: PursuitRuntime, attemptId: string, signal: AbortSignal): Promise<StepResult>;
	review(view: PursuitView, runtime: PursuitRuntime, signal: AbortSignal): Promise<StepResult>;
}
export type EngineCtx = EngineHelpers & EngineSteps;
```

元の宣言で既定値がある引数（`basisExtra: JsonObject = {}`、`extra = () => {}`）は、interface では `?` を付けて書き、既定値は実装の側に残す。

`support.ts`:

```ts
import type { EngineBase } from "./context.ts";
export function makeSupport(base: EngineBase) {
	const { deps, store, clock, ids, warn, read, result, inference, llmRow, call, checkTime } = base; // 使うものだけでよい
	async function askJudge(/* そのまま */) { /* そのまま */ }
	// … 葉の関数をそのまま移す
	return { askJudge, recordFindings, recordDeadEnd, checkedFindings, writeJudgements, featuresOf, changingTools, firedSignals, reject };
}
```

`transitions.ts`（`propose.ts`・`attempt.ts`・`review.ts` も同じ形）:

```ts
import type { EngineCtx, EngineSteps } from "./context.ts";
export function makeTransitions(ctx: EngineCtx): Pick<EngineSteps, "finish" | "stepBack" | "consult" | "plan" | "hypothesize"> {
	const { deps, store, clock, ids, warn, read, result, inference, llmRow, call, checkTime,
		askJudge, recordFindings, recordDeadEnd, checkedFindings, writeJudgements, featuresOf, changingTools, firedSignals, reject } = ctx; // 使うものだけでよい
	async function finish(/* そのまま */): Promise<StepResult> { /* 本体。段の関数の呼び出しだけ ctx. を付ける */ }
	// …
	return { finish, stepBack, consult, plan, hypothesize };
}
```

`engine.ts` の `createPursuitEngine`:

```ts
export function createPursuitEngine(deps: EngineDeps): PursuitEngine {
	const base = makeBase(deps);
	const { store, clock, ids } = deps;
	const { read, result } = base;
	const ctx = { ...base, ...makeSupport(base) } as EngineCtx;
	Object.assign(ctx, makeTransitions(ctx), makePropose(ctx), makeAttempt(ctx), makeReview(ctx));
	return {
		// start・step・answer・cancel・view を、そのまま移す。中の段の関数の呼び出しには ctx. を付ける
	};
}
```

**ctx. の規則（ここが一番まちがえやすい）:**

- 段の関数 9 個（`finish`・`stepBack`・`consult`・`plan`・`hypothesize`・`propose`・`attempt`・`resumeSettlement`・`review`）は、**どのファイルでも、同じファイルの中でも、必ず `ctx.名前(…)` で呼ぶ。** 分割代入しない。組み立ての順のせいで、分割代入すると `undefined` を掴むため。
- それ以外（`EngineBase` と `support.ts` の関数）は、各ファイルの先頭で分割代入した名前のまま呼んでよい。
- 本体の中身は、`ctx.` を付けること以外、1 文字も変えない。整形は `bun run format` に任せる。
- `helpers.ts` の関数や定数は、使うファイルで import する。

**3-5. 移す順番（1 段ごとに確かめてコミットする）**

1. `helpers.ts`
2. `context.ts`（`makeBase` と型。この時点では `support.ts` 以降はまだないので、`EngineHelpers` を一時的に `EngineBase` にしてよい。3 で直す）
3. `support.ts`
4. `transitions.ts`
5. `propose.ts`
6. `attempt.ts`
7. `review.ts`

各段のあとに、次を実行する。

```sh
bun run format
bun run typecheck
PURSUIT_GOLDEN=1 bun test test/scenario src/domains/loop
git status --short test/scenario/__snapshots__     # 何も出ないこと（snapshot が変わっていない）
git add src/domains/loop
git commit -m "loop: move <名前> out of engine.ts, no behavior change (plan 2026-11-02 §3)"
```

- snapshot が合わない → その段の差分を見直す（たいていは `ctx.` の付け忘れか、移すときの写し間違い）。**`--update-snapshots` は絶対に使わない。**
- 一つの段で 3 回直しても通らないときは、その段の変更を Edit で元に戻し（`git checkout` は使わない）、止まって報告する。

**3-6. 仕上げの確認**

```sh
bun run verify
bun run build
wc -l src/domains/loop/*.ts
git diff --stat <3-2 のコミット>..HEAD     # src/domains/loop/ の下だけが変わっていること
git diff <3-2 のコミット>..HEAD -- src/index.ts scripts/domains.ts   # 何も出ないこと
```

### 完了の条件

- [ ] `engine.ts` が 400 行以下、ほかの新しいファイルがそれぞれ 700 行以下。
- [ ] `PURSUIT_GOLDEN=1 bun test test/scenario` が、3-2 で作った snapshot のまま通る。
- [ ] `bun run verify` と `bun run build` が通る。
- [ ] `src/index.ts`・`scripts/domains.ts`・`test/` の下（harness.ts と snapshot 以外）が変わっていない。
- [ ] push 済み。

---

## 8. フェーズ 4: π² 以外の主課題を 3 題足す（環境 A、上限 $3）

**目的:** 改善の判断を π² の 1 題に頼らないように、同じくらいの難しさの証明の課題を足す。足したら、まず難しさだけを確かめる（中くらいの課題だけを主課題として使う）。

### 4-1. 課題を足す

`eval/tasks/e/problems.ts` の `reasoningTasks` の中で、`id: "e4-zeta3-irrational"` の `defineReasoningTask({` の**直前**に、次の 3 つをそのまま入れる。`exactClaim` と `noGaps` は、同じファイルの先頭に定義がある。

```ts
	defineReasoningTask({
		id: "e4-zeta2-beukers",
		domain: "math",
		level: 4,
		title: "ζ(2) の無理数性（Beukers の積分）",
		statement:
			"ζ(2) = Σ_{n=1}^∞ 1/n² が無理数であることを、二重積分 I_n = ∫₀¹∫₀¹ (1−y)ⁿ P_n(x)/(1−xy) dx dy（P_n(x) = (1/n!) dⁿ/dxⁿ [xⁿ(1−x)ⁿ]）を使って証明せよ。ζ(2) = π²/6 や、π の無理数性・超越性は使わないこと。d_n = lcm(1, 2, …, n) について d_n ≤ 3^n（n ≥ 1）は証明なしで使ってよい。",
		document: true,
		numericChecks: false,
		rubric: [
			{
				id: "integrals",
				text: "∫₀¹∫₀¹ x^r y^s/(1−xy) dx dy の値（r > s なら (1/(r−s))(1/(s+1)+…+1/r)、r = s なら ζ(2) − Σ_{k=1}^{r} 1/k²）を正しく示している",
			},
			{
				id: "integrality",
				text: "I_n = (a_n + b_n ζ(2))/d_n²（a_n, b_n ∈ ℤ）の形になることを正しく示している",
			},
			{
				id: "transform",
				text: "x について n 回部分積分して I_n = (−1)ⁿ ∫₀¹∫₀¹ xⁿ(1−x)ⁿyⁿ(1−y)ⁿ/(1−xy)^{n+1} dx dy を正しく導き、I_n ≠ 0 を示している",
			},
			{
				id: "bounds",
				text: "x(1−x)y(1−y)/(1−xy) ≤ ((√5−1)/2)⁵ から |I_n| ≤ ((√5−1)/2)^{5n} ζ(2) を示し、d_n²|I_n| → 0 を正しく評価している",
			},
			exactClaim,
			noGaps,
		],
		reference:
			"Beukers (1979)。r > s なら ∫∫ x^r y^s/(1−xy) = Σ_{k≥0} 1/((r+k+1)(s+k+1)) = (1/(r−s))(1/(s+1)+…+1/r)、r = s なら ζ(2) − Σ_{k≤r} 1/k²。分母はどちらも d_r² を割る。P_n は整数係数なので I_n = (a_n + b_n ζ(2))/d_n²。Dⁿ_x[1/(1−xy)] = n! yⁿ/(1−xy)^{n+1} と、xⁿ(1−x)ⁿ の n 階未満の導関数が 0, 1 で 0 になることから、n 回の部分積分で I_n = (−1)ⁿ ∫∫ xⁿ(1−x)ⁿyⁿ(1−y)ⁿ/(1−xy)^{n+1}。被積分関数は [x(1−x)y(1−y)/(1−xy)]ⁿ/(1−xy) で、括弧の最大は ((√5−1)/2)⁵ ≈ 0.0902、∫∫ 1/(1−xy) = ζ(2) なので 0 < |I_n| ≤ 0.0902ⁿ ζ(2)。ζ(2) = p/q なら q d_n²|I_n| は正の整数だが ≤ q·9ⁿ·0.0902ⁿ ζ(2)（9 × 0.0902 ≈ 0.81）→ 0 で矛盾。",
		traps: [
			"r = s の積分で ζ(2) が出ることの省略",
			"分母が d_n² を割ることの省略",
			"I_n ≠ 0 の省略",
		],
	}),
	defineReasoningTask({
		id: "e4-e-transcendental",
		domain: "math",
		level: 4,
		title: "e の超越性",
		statement:
			"e が超越数である（0 でない整数係数の多項式の根にならない）ことを証明せよ。e の超越性そのもの、Lindemann–Weierstrass の定理、Gelfond–Schneider の定理は引用せず、証明の中で示すこと。素数が無限に存在することは使ってよい。手法は問わない。",
		document: true,
		numericChecks: false,
		rubric: [
			{
				id: "setup",
				text: "a_0 ≠ 0 として Σ_{k=0}^m a_k e^k = 0 を仮定してよいことを示し、補助の多項式（例: f(x) = x^{p−1}(x−1)^p⋯(x−m)^p/(p−1)!）と I(t) = ∫₀ᵗ e^{t−u} f(u) du を正しく構成している",
			},
			{
				id: "identity",
				text: "I(t) = e^t Σ_j f^{(j)}(0) − Σ_j f^{(j)}(t) を導き、J = Σ_k a_k I(k) = −Σ_k Σ_j a_k f^{(j)}(k) を正しく示している",
			},
			{
				id: "nonzero-integer",
				text: "大きな素数 p について J が 0 でない整数であること（k ≥ 1 や j ≥ p の項は p の倍数で、k = 0, j = p−1 の項 a_0((−1)^m m!)^p だけが p > max(m, |a_0|) のとき p で割り切れない）を正しく示している",
			},
			{
				id: "bound",
				text: "|J| ≤ C^p/(p−1)!（C は p によらない）と評価し、p → ∞ で |J| < 1 となることから矛盾を導いている",
			},
			exactClaim,
			noGaps,
		],
		reference:
			"Hermite の証明（Hilbert・Hurwitz の形）。整数 a_k で Σ_{k=0}^m a_k e^k = 0 と仮定（a_0 = 0 なら e のべきで割って a_0 ≠ 0 にできる）。素数 p に対し f(x) = x^{p−1}(x−1)^p⋯(x−m)^p/(p−1)!、N = deg f = (m+1)p − 1、I(t) = ∫₀ᵗ e^{t−u} f(u) du = e^t Σ_{j=0}^N f^{(j)}(0) − Σ_{j=0}^N f^{(j)}(t)。J = Σ a_k I(k) = −Σ_{k=0}^m Σ_{j=0}^N a_k f^{(j)}(k)（仮定で e^k の項が消える）。k ≥ 1 では f^{(j)}(k) はすべて p の倍数の整数。k = 0 では j < p−1 で 0、j = p−1 で ((−1)^m m!)^p、j ≥ p で p の倍数。p > max(m, |a_0|) なら J ≢ 0 (mod p) なので |J| ≥ 1。一方 [0, k] 上で |f| ≤ m^{(m+1)p}/(p−1)! なので |J| ≤ (Σ|a_k| k e^k) m^{(m+1)p}/(p−1)! → 0。矛盾。",
		traps: [
			"a_0 ≠ 0 にできることの省略",
			"k = 0, j = p−1 の項だけが p で割り切れないことの確認の省略",
			"上からの評価の省略",
		],
	}),
	defineReasoningTask({
		id: "e4-e-not-quadratic",
		domain: "math",
		level: 3,
		title: "e は 2 次の無理数でない",
		statement:
			"e が 2 次の無理数でない（整数 a, b, c が a e² + b e + c = 0 を満たすなら a = b = c = 0）ことを証明せよ。e の超越性や、それを含む定理は引用しないこと。手法は問わない。",
		document: true,
		numericChecks: false,
		rubric: [
			{
				id: "reduce",
				text: "a e² + b e + c = 0 を a e + b + c e^{−1} = 0 に直し、a, c が同時に 0 なら b = 0 となることを示している",
			},
			{
				id: "tails",
				text: "n!e と n!e^{−1} を整数と余り α_n, β_n に分け、0 < α_n < 1/n、|β_n| < 1/(n+1)、β_n ≠ 0 で符号が (−1)^{n+1} であることを正しく示している",
			},
			{
				id: "parity",
				text: "a α_n + c β_n が整数で、n が大きいと絶対値が 1 未満になること、n の偶奇を選べば 0 でないこと（a = 0 や c = 0 の場合も含む）を正しく示している",
			},
			exactClaim,
			noGaps,
		],
		reference:
			"Liouville (1840)。a e + b + c e^{−1} = 0 を n! 倍する。n!e = A_n + α_n（A_n ∈ ℤ、α_n = Σ_{k>n} n!/k!、0 < α_n < 1/n）、n!e^{−1} = B_n + β_n（B_n ∈ ℤ、β_n = Σ_{k>n} (−1)^k n!/k!、交代級数で 0 < |β_n| < 1/(n+1)、符号は (−1)^{n+1}）。a α_n + c β_n = −(a A_n + b n! + c B_n) は整数で、|·| ≤ (|a|+|c|)/n < 1（n 大）なので 0。c = 0 なら a α_n = 0 から a = 0。a = 0 なら c β_n = 0 から c = 0。どちらも 0 でないなら、a α_n と c β_n が同じ符号になる偶奇の n を選べば和は 0 でない。矛盾。よって a = c = 0、さらに b = 0。",
		traps: ["a = 0 や c = 0 の場合の省略", "β_n の符号の扱いの誤り"],
	}),
```

```sh
bun run format
bun test eval/tasks/e/test/reasoning.test.ts
bun run verify
git add eval/tasks/e/problems.ts
git commit -m "eval: three proof tasks between pi^2 and zeta(3) (e4-zeta2-beukers, e4-e-transcendental, e4-e-not-quadratic) (plan 2026-11-02 §4)"
```

試験が落ちたら、エラーの文を読み、**足した 3 つの定義の書き写しの誤りだけ**を直す。既存の試験を変えない。

### 4-2. 難しさを確かめる（band-2）

条件: フェーズ 2 の結論が「判定層は π² の通過を上げた」なら E3。それ以外（中止を含む）なら E1R。フラグはフェーズ 2 の `BASE` と同じにする。

```sh
bun standalone/cli.ts spend      # A_NOW。上限を A_NOW + 3 にする
bun standalone/cli.ts settings set spend.limitUsd <A_NOW + 3>
bun eval/main.ts run --name band-2 --conditions <E3 か E1R> --tasks e4-zeta2-beukers,e4-e-transcendental,e4-e-not-quadratic --repeat 3 $BASE --concurrency 3 2>&1 | tee -a eval/results/band-2.log
bun eval/main.ts report --name band-2
bash /tmp/tally.sh band-2
bun eval/analyze.ts band-2 --strategies > eval/results/band-2/analysis.md
```

誤りの扱いは、フェーズ 1 の 1-3 と同じ。誤りが分割したエンジン（フェーズ 3）に原因がありそうなら、止まって報告する。

**判定（課題ごと、事前に決めた規則）:**

| 3 回中の正しく完了 | 判定 | 扱い |
| --- | --- | --- |
| 1 か 2 | 中くらい | 主課題として使う |
| 0 | 難しすぎ | 定義は残す。主課題には使わない |
| 3 | 易しすぎ | 定義は残す。主課題には使わない |

文面を変えて、難しさを合わせることはしない。

### 4-3. 記録・公開・コミット

`spec/results.md` の末尾に、次の書式で足す。

```markdown
## band-2: π² 以外の主課題の下見（【実行日】）

構成: 【E3 か E1R】、【BASE の値】、各 3 回。

| 課題 | 正しく完了 | 申告（通過 / 全体） | 試行（平均） | 判定 |
| --- | --- | --- | --- | --- |
| e4-zeta2-beukers | 【x/3】 | | | 【中くらい／難しすぎ／易しすぎ】 |
| e4-e-transcendental | | | | |
| e4-e-not-quadratic | | | | |

主課題として使う課題: 【中くらいの課題の id。なければ「なし」】
```

```sh
bun standalone/cli.ts settings set spend.limitUsd <元の上限>
echo band-2 >> eval/results/PUBLISHED
git add -f eval/results/band-2/runs.jsonl eval/results/band-2/summary.md eval/results/band-2/analysis.md
bun run verify
git add spec/results.md spec/improvement-plan-2026-11-02.md eval/results/PUBLISHED
git commit -m "band-2: difficulty check of the three new proof tasks (plan 2026-11-02 §4)"
git push
```

### 完了の条件

- [ ] 3 題が `reasoningTasks` にあり、`bun run verify` が通る。
- [ ] `band-2` に 9 件の誤りのない記録があり、`spec/results.md` に判定がある。
- [ ] 公開・上限の戻し・push が済んでいる。

---

## 9. 予算

| フェーズ | 環境 | 上限 | 見込み | 上限の掛け方 |
| --- | --- | --- | --- | --- |
| 0 | B | $0 | $0 | API を使わない |
| 1 | B | $25 | 下見 ≤ $3、本番は下見から計算 | B の `spend.limitUsd = B_NOW + 25` |
| 2 | A | $5 | 約 $2.5（completion-1 の acceptance の腕が π² 10 回などで $1.23） | A の `spend.limitUsd = A_NOW + 5` |
| 3 | A か B | $0 | $0 | API を使わない |
| 4 | A | $3 | 約 $1.2 | A の `spend.limitUsd = A_NOW + 3` |
| 合計 | | **$33** | | |

2026-11-02 の環境 A の計器は $38.854。計画を最後まで実行すると、A の値は最大で約 $47 になる。B の値も合わせて、クレジット $100 と、決めてある上限 $90 の内側に収める。各フェーズの最後に、上限を元の値（ふつうは 90）に戻す。

---

## 10. 止まるとき・報告するときの書式

次のどれかのときは、作業を止めて、この書式で報告する。

- 前提の確認が通らない。
- 計画の手順どおりにできない（ファイルの形が違う、コマンドが失敗するなど）。
- 規則（§2）を破らないと先に進めない。
- 同じ失敗を、計画で許した回数を超えて繰り返した。

```text
【停止】フェーズ <n> 手順 <n-m>
起きたこと: <エラーの文をそのまま 1〜5 行>
そのときの状態: HEAD=<hash>、git status=<空/内容>、計器=<環境>:<値>
試したこと: <何を何回>
選択肢: <考えられる次の手を 1〜3 個。どれを選ぶかは利用者が決める>
```

---

## 11. 最終報告（フェーズ 5）

すべてのフェーズが「済み」か「中止」になったら、次を利用者に報告する。

```text
フェーズ 0: <済み/中止>。ablation-1 の記録: <書いた節の結論 1 行>
フェーズ 1: <済み/中止>。結論: <1-5 で選んだ文>。E1R a/n、D0 b/n、p=…
フェーズ 2: <済み/中止>。結論: <2-4 で選んだ文>
フェーズ 3: <済み/中止>。engine.ts <行数>、新しいファイル <各行数>
フェーズ 4: <済み/中止>。主課題として使う課題: <id>
費用: 環境 A <前>→<後>、環境 B <前>→<後>
未解決: <あれば>
利用者に決めてほしいこと: <§12 のうち、結果で判断が必要になったもの>
```

---

## 12. 利用者が決めること（実行者は決めない）

1. 予算の配分（§9）。変えるときは、この計画書の数字を書き換えてから渡す。
2. フェーズ 1 の結論が「床」か「差は見えない」だったときの次の手。候補は、課題を短くする、予算を変える、構造のうち効いていそうな部品だけを残す、など。
3. フェーズ 2 で「判定層の上積みは見えない」だったとき、Eumenes への取り込みの範囲から判定層を外すかどうか。
4. コミット `7198e88`（「not for push」と書かれたまま origin/main に入っている）の扱い。中身はファイル経由の LLM の port で、秘密は含まない。履歴の書き換えはしない前提で、このまま残すのを勧める。
5. `hz11-water-ratio` を比較に入れるかどうか（コーパスサーバーの起動とモデル採点の費用が要る）。

## 13. この計画でやらないこと

- プロンプト・policy・フラグの改善や追加。hz11 の課題の修正。
- 引用の妥当性のヒューリスティック（`spec/fixes-2026-10-22-g.md` §10）のような、語句による判定の追加。
- ローカル LLM の接続、定期の上位レビュー、Eumenes への取り込み（P3〜P5）。
- 過去の結果の書き換え。公開済みの run の変更。
- 引継ぎの検証の項目 1〜6（`spec/improvement-implementation-2026-10-22.md`）の実施。状態を書くだけにする。
