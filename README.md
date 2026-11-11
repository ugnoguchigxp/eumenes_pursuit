# eumenes-pursuit

Eumenes の「自律試行」を、本体から切り離して研究・検証するプロジェクトです。利用者が望む結果と条件を渡すと、AI が方針と仮説を立て、予測を書いてから道具を使い、観測を予測と比べて、続ける・仮説を変える・方針を見直す・相談する・止める、を判断します。最後に根拠を添えて報告します。

LLM は小さな試行錯誤はできても、大きな視点からの試行錯誤が苦手です。うまくいかないと周辺をいじって壊したり、受入条件をすり替えたり、同じ失敗を繰り返したり、成功を装ったりしがちです。本プロジェクトは、メタ認知をモデルの内側に期待せず、構造の外側（規則層・判定層・別文脈の振り返り）に置くことで、壊す前に止まれるかを、大量の live の試行で確かめます。十分に検証できたら、`eumenes-world-model` と同じ形（版つき tgz を Eumenes の `vendor/` に置く）で Eumenes に取り込みます。

- [計画書](plan.md) — 研究の問い、構成、ループ、実験計画、フェーズ
- [P0 の決定](spec/p0-decisions.md) — 未決事項 U1〜U9 の決定と、LARM の d1 の確定した仕様
- [ホスト接続契約](spec/host-contract-v1.md) — Eumenes との接点（v1.1）
- [知見の保持の設計](spec/findings-design.md) — 棄却する仮説と、残す補題・観測・行き止まりを分けて持つ
- [やりきりの点検の設計](spec/persistence-design.md) — 方針の部品と自己評価、途中の査読、相談の空回りの禁止
- [検証結果](spec/results.md) — live の評価の記録と所見
- [照合の設計](spec/verification-design.md) — 照合を申告のときだけにする、反証できる予測
- [完了の判断の設計](spec/completion-design.md) — 読み直しと受入条件ごとの判断
- [教訓の設計](spec/lessons-design.md) — 解けた追求と解けなかった追求の対比から、題材によらない手順の教訓を作る
- 保留中の設計: [定期の上位レビュー](spec/advisor-design.md)、[プロンプトの予算](spec/prompt-budget-design.md)、[長い予算での継続性](spec/long-horizon-design.md)
- [LARM への依頼](spec/larm-general-decision-request-2026-10-20.md)

## 構成

```
            ┌──────────────────────────────────────────────┐
            │ 規則層（コード・決定的）                      │
            │ 予算 / 権限 / 受入条件の不変 / 同じ失敗の禁止 │
            └──────────────────────────────────────────────┘
                         ▲ 拒否        ▲ 拒否
┌────────────────────┐   │    ┌───────────────────────────┐
│ 生成層（LLM）       │───┘    │ 判定層（LARM の d1）        │
│ 方針・仮説・予測    │ 提案   │ 状況の分類と確率            │
└────────────────────┘──────▶└───────────────────────────┘
          ▲                              │ 一段上へ戻す / 相談
          └──────── 振り返り（LLM・別の文脈）◀┘
```

完了は、生成層の申告ではなく、ホストの照合が通ったときだけ認めます。判定器は慎重な方向（止める・戻す・相談）にだけ動かせます。

| 場所 | 中身 | Eumenes への配布 |
| --- | --- | --- |
| `src/contracts` | 契約（store・道具・作業領域・照合・判定器・LLM の port、policy、入力と報告） | 含む |
| `src/domains/ledger` | 台帳（SQLite、ホストの単一 writer の transaction 内で動く同期関数、migration） | 含む |
| `src/domains/rules` | 規則層（予算、指紋、予測の必須、兆候の検出） | 含む |
| `src/domains/judge` | 質問セット（版つき、日本語・英語）、判定器の入力の組み立て、答えの解釈 | 含む |
| `src/domains/generation` | 生成層と振り返りのプロンプトと出力の schema | 含む |
| `src/domains/loop` | 一手ずつ進めるループ（engine） | 含む |
| `standalone/` | 単独で動かすためのホスト（Claude/OpenAI API の LLM port、LARM の d1 接続、store、設定、費用の上限） | 含まない |
| `eval/` | 課題セット、道具、照合、評価の実行器、指標、分析 | 含まない |

core（`src/`）は時計・乱数・ネットワーク・ファイル・`process` を直接使いません。`bun run check:boundaries` で検査します。

## 準備

Bun 1.4 以上と Python 3.11以上（sympy・mpmath。群 E の数値の検算に使う）が要ります。

群 D のコード実行には、macOS の `sandbox-exec` または Linux の `bubblewrap`・`prlimit` が必要です。隔離できない環境では実行を拒否します。

```sh
bun install
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-eval.txt
bun run verify          # 整形・lint・型・境界・決定的な試験・性能
```

live の評価には次が要ります。

- 環境変数 `ANTHROPIC_API_KEY`。共通設定として `~/.zprofile` などからexportすれば、プロジェクトごとの `.env` は不要です。手元では `CLAUDE_API_KEY` から標準名へ引き継ぐ設定を用意しています。
- 環境変数 `LARM_API_TOKEN`（LARM Control の Bearer）
- 手元の設定（`data/pursuit-settings.sqlite`、gitignore 済み）

OpenAI接続は、標準の `OPENAI_API_KEY` を使います。手元の共通設定 `OPEN_AI_API_KEY` も `~/.zprofile` でこの名前へ引き継ぎます。設定変更後は新しいログインシェルを開くか、既存のターミナルで `source ~/.zprofile` を実行してください。キーの値はレポジトリへ保存しません。

```sh
cp config/settings.example.json /tmp/settings.json   # 値を自分の環境に合わせる
bun standalone/cli.ts settings init /tmp/settings.json
bun standalone/cli.ts settings show
bun standalone/cli.ts spend                           # これまでの API の支出
```

設定には、LARM Control の origin、d1 の profile の selector、audience、生成層・振り返り・採点のモデル、費用の上限と単価を入れます。モデル名はコードに書かず、設定からだけ読みます。

## APIの選択と費用の復旧

生成・振り返りのproviderを明示します。既存のprovider未指定設定はClaudeとして読めます。

```sh
bun standalone/cli.ts settings set llm.generator '{"provider":"openai","model":"gpt-6-luna","effort":"medium","thinkingHeadroom":6000}'
bun standalone/cli.ts settings set llm.reviewer '{"provider":"openai","model":"gpt-6-luna","effort":"medium","thinkingHeadroom":6000}'
bun standalone/cli.ts budget set campaign:my-validation 10
```

`--llm api --budget-id my-validation` を評価の実行に付けると、両providerで共有する上限を使います。価格は `spend.pricing` へ公式料金に基づいて設定してください。通常入力・出力のほか、cacheRead/cacheWrite、inputLong/outputLong、longThreshold、maxInputTokensを指定できます。呼出前にはモデル最大入力と最大出力に基づく保守的な額を予約します。そのため、支出済み額が上限より少なくても、予約余力が足りなければ止まります。SDKの自動再試行は無効です。

```sh
bun standalone/cli.ts budget show
bun standalone/cli.ts spend
# 成否不明の呼出は、請求資料または承認済み上界を根拠に追記して照合します。
bun standalone/cli.ts spend reconcile <call-id> <USD> <operator> invoice '<billing-reference>'
bun standalone/cli.ts spend reconcile <call-id> <USD> <operator> upper_bound '<documented-bound>'
```

送出後の接続断・強制終了では予約が残ります。照合前にDBや履歴を消さず、call-idと根拠を確認してください。`upper_bound` は実請求の確認とは区別され、原本のunknownと照合履歴を保持します。終端報告の照合が失敗した場合、ホストは `engine.reverify(id, runtime, signal)` で道具や生成を再実行せず照合だけをやり直せます。

要求モデルに加え、APIが返した実モデルの料金も登録が必要です。実モデルの料金が未登録なら、応答の利用量を保存し、費用不明として後続の呼出を止めます。別モデルの料金で代用しません。請求資料に基づく `invoice` は予約額を超えても実額を記録します。その結果上限を超えた場合は次の呼出を禁止します。推定値の `upper_bound` は元の予約額以下に限ります。

通常の `bun run verify` はAPIキーを使わない試験です。Linuxの使い捨て検証は `scripts/verify-linux.sh`、coreだけの配布物の作成は `bun run pack:core` で行います。CIはmacOS/Linuxを対象に同じ検証とビルドを実行します。パッケージは公開しません。

`bun run check:performance` は `verify` にも含まれます。固定の模擬応答と永続SQLiteを使い、10・100・200試行 × 1・2・4追求で、stepのp95 250ms以下、測定時RSS 512MiB以下、読み戻し5秒以下を検査します。環境・負荷別の実測値と閾値をJSONで出力します。APIの待ち時間は含まず、実測値を新しい閾値として自動採用しません。

## live の評価

`--conditions D0,E1R,AUTO` で、直接解法・追求・LLMによる方式選択を比較できます。AUTOは開始時に目標・道具・モデル・予算を見てD0/E1Rを選び、判断理由を記録します。選択の費用・時間・要求数も予算に含みます。`--selection-evidence <file>` は比較の観測記録を選択役へ渡す任意の資料です。課題名やモデル名による選択規則はありません。

`--conditions D0,E1R,productive` では、直接解法、振り返り付きの追求、進展評価付きの追求を同じ課題・道具・受入検証で比較できます。この3条件はLARMなしで実行でき、`productive` の判断には設定済みのreviewerを使います。評価実行器は判断と道具を順次処理します。ホスト上の非同期実行や待機の検証には [Eumenesエミュレータ](examples/eumenes/README.md) を使います。

`--advisor` は設定の `llm.strong` を上位レビューの道具として貸します。呼ぶかどうかはLLMが判断します。直接解法にも同じ道具を貸し、費用はadvisorとして計測します。追求では既存の保留道具の仕組みで予約・結果を永続化します。`--pause-on-advice` または `--pause-after-tools N` で対応課題を保留し、同じ実行引数に `--resume` を加えると、追求ID・作業領域・費用scopeを維持して再開します。設定・ソースが違う場合は再開を拒否します。送出済みで結果不明のレビューは自動再送しません。直接解法の途中再開には対応していません。

`hz12-study-cache` と `hz12-study-scheduler` は唯一の正解を持たない調査課題です。実験から費用・処理量・公平性のトレードオフを調べ、未確定の結論も報告できます。受入検査は引用した実験の出典と数値を照合し、自由記述の品質や最適性は保証しません。2題の小規模比較の範囲は [検証計画](spec/adaptive-study-2026-11-07.md) を参照してください。

集計には失敗分と選択・レビューを含む総費用・総時間、および正しい結末1件あたりの総費用・時間を追加しました。未知費用・欠落はunknownと表示します。「偽の完了」はホスト照合との整合性であり、検証器自身の誤合格率ではありません。

```sh
# 条件 E0〜E3 × 全課題
bun eval/main.ts run --name base --conditions E0,E1,E2,E3 --concurrency 3

# 群 E（数学）を、道具の段階・知見の構成を変えて
bun eval/main.ts run --name math --groups E --conditions E3 --tools 2 --findings verified --repeat 3

bun eval/main.ts report --name base     # 集計（eval/results/<name>/summary.md）
bun eval/analyze.ts base                # 失敗の傾向（止まり方・落ちた基準・道具の使い方）
bun eval/analyze.ts math --depth        # 照合の通過（95% 区間）・部分点・深さ
bun eval/analyze.ts math --strategies   # 追求ごとの方針の一覧
bun eval/trace.ts base <task>           # 一つの追求の経緯
bun eval/trace.ts --ledger /path/to/example.sqlite  # 既存の台帳を読み取り専用で確認

# 追求と直接解法の比較（ablation-1。実行ごとに別の名前）
bun eval/main.ts run --name abl1-direct-r1 --conditions D0 --policy config/policy.v5.json ...
bun eval/analyze.ts --compare abl1-pursuit-r1 abl1-pursuit-r2 abl1-pursuit-r3 abl1-direct-r1 abl1-direct-r2 abl1-direct-r3
```

| 選択肢 | 値 |
| --- | --- |
| `--conditions` | E0（素のループ）、E1（＋規則層）、E2（＋判定層）、E3（＋振り返り）、E4（＋adapter） |
| `--groups` | A（正しく未完了）、B（経路の変更）、C（根拠つきの比較）、D（小さなコーディング）、E（証明・答え） |
| `--tools` | 0（なし）、1（＋厳密な計算）、2（＋技法の資料）、3（＋補題の資料）。群 E で使う |
| `--findings` | off、verified（照合済みの知見と行き止まりだけを見せる）、all（未確認の主張も見せる） |
| `--strategy` | free（別の方針なら何でも）、distinct（核となる考え方が違う方針を求め、未採用の別案を示し直す） |
| `--self-check` | off、parts（方針を部品に分け、方針を捨てる前に部品ごとの自己評価を求める。やりきるまで規則層が方針を保つ） |
| `--critic` | 群 E に途中の査読の道具 `review_draft` を足す（採点基準を見ない別の文脈が飛躍を指摘する） |
| `--verify-on` | attempt（作業領域を変える試行のたびに照合する）、claim（完了の申告のときと、終わるときだけ照合する） |
| `--completion-check` | off、acceptance（一段上へ戻る・断念する前に、成果物を読み直して受入条件ごとに判断させる。すべて満たしていれば申告を促す） |
| `--rollback` | notify（既定。一段上へ戻るときに作業領域を戻したら、戻したファイルを台帳に残し、次の要求で生成器に伝える）、keep（戻さない） |
| `--verdict-label` | refutation（既定。試行の判定を、機械で判定できる refutedIf と観測の突き合わせで示し、それ以外は「未判定」とする）、status（以前の表示。道具の状態が予測どおりなら「予測どおり」） |
| `--prediction` | status（状態と観測を予測する）、falsifiable（どんな観測が出たら仮説が誤りかも書かせる） |
| `--conditions D0` | 直接解法（追求の構造なし）。同じ課題・道具・照合・採点で、毎回 道具を 1 回使う／完了を申告する／断念する を選ばせる。予算は policy の追求全体の予算（試行・壁時計・手順）に合わせる。[spec/ablation-design.md](spec/ablation-design.md) |
| `--claim-feedback` | off（既定）、verdict（完了の申告の結果 合格/不合格 を、そのあとの計画・仮説・提案・振り返りのすべての要求に書く。`--llm file` では課題が終わるたびに最後の申告の結果を `<llm-dir>/notices/` に書く。D0 にも効く） |
| `--attempt-count` | all（既定）、mutating（仮説ごとの試行予算に、作業領域を変える道具＝書き込み・実行・提出だけを数える。資料の取得だけでは一段上へ戻らない。追求全体の予算はすべて数える） |
| `--direct-full-entries` | D0 で全文を見せる直近の行動の数（既定 40。古いものは一行の要約） |
| `--policy` | `config/policy.v1.json`（既定）、`config/policy.v2.json`（答えの付いた相談のあと、何も試さずに再び相談することを禁じる）、`config/policy.v3.json`（v2 に加え、一段上へ戻る予算を 8 回にして、方針 3 × 仮説 3 と釣り合わせる）、`config/policy.v5-tight.json`（v5 の試行・壁時計・手順を半分にした比較用の予算。記録の `budgetTag` は v5-tight）、`config/policy.v6-long.json`（長い課題 hz11 用: 試行 200・壁時計 120 分・手順 1500・方針 8・一段上へ 40。D0 と E1R で共通。[spec/long-horizon-11.md](spec/long-horizon-11.md)） |

結果は `eval/results/<name>/` に残ります。既定では手元だけに残り（`.gitignore`）、公開する回だけを `eval/results/PUBLISHED` に名前で載せて、その記録（`runs.jsonl`）・集計（`summary.md`）・分析（`analysis.md`）を `git add -f` でレポジトリに入れます。台帳（sqlite）とログは常に手元に残します。`bun run verify` の `check:results` が、公開の一覧にない回の結果や台帳がインデックスに入っていれば失敗します（コミット前に自動で走らせるなら `git config core.hooksPath scripts/hooks`）。課題の作業領域は OS の一時ディレクトリに作ります。群 D と群 E では、LLM が書いたコードや式を手元で実行します。実行は sandbox（ネットワークなし、ホーム配下の読み取りなし）と時間制限の中で行い、道具の出力からは秘密の値を伏せます。

## 照合の確かさ

照合の結果には確かさの区分が付きます。

- `exact`: 決定的な比較、有理数・記号の計算、区間演算
- `numeric`: 高精度の数値評価と許容誤差
- `model`: 別の文脈の LLM による採点（群 E の証明）

`model` は機械検査ではありません。結果を読むときは区別してください。

## 到達点（2026-10-21）

生成層は安いモデル（Claude Haiku 5.5）のまま、仕組みの側でどこまで解けるかを測っています。数字は、今の土台の構成で、生成層が自分で完了を申告して照合に通った割合です。土台は、条件 E3、policy v3、照合は申告のときだけ、反証できる予測、読み直しと受入条件ごとの判断を使います。

| 難しさ | 課題の例 | 解けた割合 | 出典 |
| --- | --- | --- | --- |
| 入試〜学部（L1〜L3） | π > 3.05、位数 15 の群、Serret の積分 | ほぼすべて | math-1 |
| 学部の有名な証明（別に取っておいた課題） | π・e² の無理数性、Basel 問題（Fourier を禁止） | **17/17** | reflect-1 |
| 大学院の入口の計算（L4、答え） | Euler 和、交代 Euler 和 | 解けた（各 1 回、ばらつきあり） | math-2 の再実行 |
| 大学院の入口の証明（L4） | π² の無理数性 | **6/10** | completion-1 |
| 同上（別に取っておいた課題） | ln 2 の無理数性 | 3/11（教訓ありで 5/8） | band-1・reflect-2 |
| 同上（別に取っておいた課題） | Bertrand の仮説（Erdős の証明） | 6/11（試行が多い） | band-1・reflect-2 |
| 研究の水準に近い証明 | ζ(3) の無理数性（Apéry） | **0/約 50** | math-3s 以降 |

変わらない性質:

- **偽の完了は 0。** E3 では、解けないときは理由を付けて断念するか止まり、成功を装わなかった。
- π² は、仕組みを足すごとに上がった。知見なしの基準線は 1/10 前後で、やりきりの点検、申告のときの照合、読み直しを足して 6/10 になった。
- 照合を試行のたびに行う（ホストが完了を判断する）構成では、π² は 8/10。生成層が自分で終わりを判断する構成でも、その差は 2/10 まで縮まった。
- ζ(3) の水準は、構成の核心（補助の積分・整数性・評価）を書き切れず、届いていない。

照合の一部（証明の採点）は、強いモデル（Sonnet 5.5）による判定で、機械検査ではありません（「照合の確かさ」を参照）。回数は各 4〜10 回なので、±2 程度のぶれがあります。

## 進捗

### 計画書のフェーズ（[plan.md](plan.md) §14）

| フェーズ | 中身 | 状態 |
| --- | --- | --- |
| P0 | 未決事項の合意、host contract の初版 | 済み |
| P1 | 台帳、ループ、規則層、評価の実行器（E0・E1） | 済み |
| P2 | LARM の d1 の接続、判定器の port、質問セット v1 | 接続と E2 は済み。日本語と英語の基準の比較は未実施 |
| P3 | 振り返りの工程、群 D、人のラベル付け | 振り返り（E3）は済み。人のラベルと一致率は未着手 |
| P4 | adapter の学習、閾値の校正、E4、強いモデルとの対照 | 未着手 |
| P5 | Eumenes への取り込み（tgz の配布、受け入れ設計） | 未着手 |

### 想定の使い方に向けた進捗

想定の使い方は、ローカル LLM が一晩中調べ続け、ときどき強いモデル（Fable・Opus）が見直し、その見直しを受けてさらに続けることです。今は、弱いモデルが自力で続けられることと、終わり・粘り・方針の見直し・断念の判断を、下から積み上げることを優先しています。

| 要素 | 状態 |
| --- | --- |
| 偽の完了を出さない（照合・規則層・振り返り） | 済み。全実行で 0 |
| やりきる（方針の部品と自己評価、方針を使い切る前の断念の禁止） | 済み（persist-1・persist-2） |
| 自分で終わりを判断する（申告のときの照合、読み直し、受入条件ごとの判断） | 済み。申告漏れ 0（completion-1） |
| 経験から学ぶ（題材によらない手順の教訓） | 実装済み。ln 2 で 2/8 から 5/8、有意ではない（reflect-2） |
| 長い予算で前に進み続ける（一晩の模擬） | 設計のみ（horizon-1 は未実施） |
| 定期の上位レビュー | 設計のみ（保留） |
| ローカル LLM での実行 | 未着手（単独ホストは Claude/OpenAI API に対応） |
| Eumenes への取り込み | 未着手 |

費用: Claude API の $100 のうち、計器の値で約 $39 を使いました（2026-10-21、reflect-2 の時点）。

## ライセンス

[MIT](LICENSE)
