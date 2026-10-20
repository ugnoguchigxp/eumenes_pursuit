# eumenes-pursuit

Eumenes の「自律試行」を、本体から切り離して研究・検証するプロジェクトです。利用者が望む結果と条件を渡すと、AI が方針と仮説を立て、予測を書いてから道具を使い、観測を予測と比べて、続ける・仮説を変える・方針を見直す・相談する・止める、を判断します。最後に根拠を添えて報告します。

LLM は小さな試行錯誤はできても、大きな視点からの試行錯誤が苦手です。うまくいかないと周辺をいじって壊したり、受入条件をすり替えたり、同じ失敗を繰り返したり、成功を装ったりしがちです。本プロジェクトは、メタ認知をモデルの内側に期待せず、構造の外側（規則層・判定層・別文脈の振り返り）に置くことで、壊す前に止まれるかを、大量の live の試行で確かめます。十分に検証できたら、`eumenes-world-model` と同じ形（版つき tgz を Eumenes の `vendor/` に置く）で Eumenes に取り込みます。

- [計画書](plan.md) — 研究の問い、構成、ループ、実験計画、フェーズ
- [P0 の決定](spec/p0-decisions.md) — 未決事項 U1〜U9 の決定と、LARM の d1 の確定した仕様
- [ホスト接続契約](spec/host-contract-v1.md) — Eumenes との接点（v1.1）
- [知見の保持の設計](spec/findings-design.md) — 棄却する仮説と、残す補題・観測・行き止まりを分けて持つ
- [検証結果](spec/results.md) — live の評価の記録と所見
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
bun eval/trace.ts base <task>           # 一つの追求の経緯
```

| 選択肢 | 値 |
| --- | --- |
| `--conditions` | E0（素のループ）、E1（＋規則層）、E2（＋判定層）、E3（＋振り返り）、E4（＋adapter） |
| `--groups` | A（正しく未完了）、B（経路の変更）、C（根拠つきの比較）、D（小さなコーディング）、E（証明・答え） |
| `--tools` | 0（なし）、1（＋厳密な計算）、2（＋技法の資料）、3（＋補題の資料）。群 E で使う |
| `--findings` | off、verified（照合済みの知見と行き止まりだけを見せる）、all（未確認の主張も見せる） |

結果は `eval/results/<name>/`（台帳・記録・集計、gitignore 済み）に残ります。課題の作業領域は OS の一時ディレクトリに作ります。群 D と群 E では、LLM が書いたコードや式を手元で実行します。実行は sandbox（ネットワークなし、ホーム配下の読み取りなし）と時間制限の中で行い、道具の出力からは秘密の値を伏せます。

## 照合の確かさ

照合の結果には確かさの区分が付きます。

- `exact`: 決定的な比較、有理数・記号の計算、区間演算
- `numeric`: 高精度の数値評価と許容誤差
- `model`: 別の文脈の LLM による採点（群 E の証明）

`model` は機械検査ではありません。結果を読むときは区別してください。

## 状態

計画書のフェーズ P1〜P3 の範囲を、live で検証している段階です。これまでの結果と所見は [spec/results.md](spec/results.md) にあります。Eumenes への取り込み（P5）はまだ行っていません。

## ライセンス

[MIT](LICENSE)
