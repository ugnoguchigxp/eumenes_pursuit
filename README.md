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
| `standalone/` | 単独で動かすためのホスト（Claude API の LLM port、LARM の d1 接続、store、設定、費用の上限） | 含まない |
| `eval/` | 課題セット、道具、照合、評価の実行器、指標、分析 | 含まない |

core（`src/`）は時計・乱数・ネットワーク・ファイル・`process` を直接使いません。`bun run check:boundaries` で検査します。

## 準備

Bun 1.4 以上と Python 3（sympy・mpmath。群 E の数値の検算に使う）が要ります。

群 D のコード実行には、macOS の `sandbox-exec` または Linux の `bubblewrap`・`prlimit` が必要です。隔離できない環境では実行を拒否します。

```sh
bun install
bun run verify          # 整形・lint・型・境界・決定的な試験
```

live の評価には次が要ります。

- `.env` に `ANTHROPIC_API_KEY`（gitignore 済み）
- 環境変数 `LARM_API_TOKEN`（LARM Control の Bearer）
- 手元の設定（`data/pursuit-settings.sqlite`、gitignore 済み）

```sh
cp config/settings.example.json /tmp/settings.json   # 値を自分の環境に合わせる
bun standalone/cli.ts settings init /tmp/settings.json
bun standalone/cli.ts settings show
bun standalone/cli.ts spend                           # これまでの API の支出
```

設定には、LARM Control の origin、d1 の profile の selector、audience、生成層・振り返り・採点のモデル、費用の上限と単価を入れます。モデル名はコードに書かず、設定からだけ読みます。

## live の評価

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
| `--policy` | `config/policy.v1.json`（既定）、`config/policy.v2.json`（答えの付いた相談のあと、何も試さずに再び相談することを禁じる）、`config/policy.v3.json`（v2 に加え、一段上へ戻る予算を 8 回にして、方針 3 × 仮説 3 と釣り合わせる） |

結果は `eval/results/<name>/` に残ります。記録（`runs.jsonl`）・集計（`summary.md`）・分析（`analysis.md`）はレポジトリに入れ、台帳（sqlite）とログは手元に残します。課題の作業領域は OS の一時ディレクトリに作ります。群 D と群 E では、LLM が書いたコードや式を手元で実行します。実行は sandbox（ネットワークなし、ホーム配下の読み取りなし）と時間制限の中で行い、道具の出力からは秘密の値を伏せます。

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
| ローカル LLM での実行 | 未着手（今の単独ホストは Claude API だけ） |
| Eumenes への取り込み | 未着手 |

費用: Claude API の $100 のうち、計器の値で約 $39 を使いました（2026-10-21、reflect-2 の時点）。

## ライセンス

[MIT](LICENSE)
