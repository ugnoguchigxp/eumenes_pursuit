# LARM への依頼: d1 を汎用の判断 Provider として、学習データ付きで使えるようにする

作成日: 2026-10-20
依頼元: eumenes-pursuit（Eumenes の自律試行の研究プロジェクト）

以下は LARM の作業担当にそのまま渡すプロンプトである。

---

## 依頼の目的

LARM 上の判断モデル d1（LiquidAI/d1-3B、<https://huggingface.co/LiquidAI/d1-3B>）を、用途を限らない**汎用の判断 Provider** として提供してほしい。さらに、利用側が用意した**学習データで判断を調整できる**ようにしてほしい。

利用側は eumenes-pursuit である。AI が目標に向けて試行錯誤するとき、その流れが暴走していないか、行動が目標から外れていないか、予測と観測が一致しているかを、狭い質問を多数並べて毎試行ごとに判定する。判定は速く安く、確率つきで返ってくる必要がある。質問の基準はまず文章で与え、精度が足りない判定だけを学習データで調整する。

## 現状（2026-10-20 に catalog `GET /v3/agent-profiles` を読み取り専用で確認）

- contract は `agent-connection.v3`。
- d1 は、`selectionPolicy: explicit-only` の profile 一つにだけ、Provider として載っている。capability `decision.game`、protocol `larm.system-one.v1`、endpoint `/v1/systemone`。モデル id と profile の説明から、ゲーム用に絞った版に見える。
- 同じ protocol の Provider（capability `decision.system-one`）が既定の会話 profile にもあるが、これは発話態度判定用の小型分類器で、d1 ではない。
- Provider には `description` がない。質問の型・言語・上限は catalog から分からない。
- 利用側は Eumenes と同じ手順で呼ぶ。Agent Connection を確保し（`POST /v1/agent-connections` → claim）、claim が返す baseUrl・model・token を使って、`POST {baseUrl}/v1/systemone` に本文 `{model, state, questions}` を送る。今の応答は `{model, answers: {<質問id>: {...}}}` の形である。

## 依頼事項

### R1 汎用の判断 Provider

- ゲーム用に絞っていない d1 の基本モデルを、新しい Provider として提供する。
- capability の名前は `decision.general` を提案する。LARM 側の命名規則に合う名前があれば、それでよい。決めた名前を報告してほしい。
- protocol は、できれば `larm.system-one.v1` と互換に保つ。R2・R3 で互換を保てない場合は、新しい版（例: `larm.system-one.v2`）にする。
- 背景処理の client が、会話の profile を選ばずに確保できる profile に載せる（`explicit-only` の background 用 profile など）。
- 会話 profile と実行基盤を共有する場合は、確保が会話に与える影響（モデルの入れ替え、待ち、idle release）を確かめ、その結果を報告してほしい。
- 既存の `decision.system-one` と `decision.game` の挙動は変えない。

### R2 質問の型と応答

d1 の `system_one` が持つ型を、すべて HTTP で使えるようにする。

| 型 | 質問の定義 | 応答 |
| --- | --- | --- |
| `noul` | `instructions` | P(yes) |
| `choice` | `instructions`、`criteria`（選択肢名 → 基準文） | 選んだ選択肢、`confidence`、`probabilities` |
| `score` | `instructions`、段階ごとの基準文の配列（2〜10段階） | 期待値、`confidence`、`probabilities`、`legend` |

- 1回の要求で多数の質問をまとめて送れるようにする（`system_one_batch` 相当でもよい）。
- `state` は、JSON オブジェクト・テキスト・画像（任意）を受け付ける。
- 応答には、質問ごとの答えに加えて、`model` と、使った adapter の id・版（R3）を必ず含める。
- 上限（1要求あたりの質問数、state の bytes・tokens、画像の数と大きさ）を決め、超えたら決まったエラーコードで拒否する。
- **日本語の state と、日本語の基準文で、意味のある確率が出るかを確かめる。** 同じ質問を英語の基準文で投げた場合とも比べ、結果を報告してほしい。

### R3 学習データで判断を調整する

利用側は、質問セット（質問の定義の束）ごとに、正解ラベル付きの例を用意する。LARM には、それを使って判断を調整する手段を用意してほしい。

1. **調整の方法を調べる。** d1 の fine-tuning の手順は公開されていない。`system_one` が答えをどう計算しているか（答えの token の logits から計算しているのか、など）を調べ、ベースを壊さない調整方法（LoRA などの adapter、出力側の軽い head の再学習、など）を選んでほしい。調整できない、または効果がない場合は、そう報告して代わりの案を出す。別のモデルに黙って差し替えない。
2. **学習の API。** 非同期の job とする。HTTP 202 で jobId を返し、状態照会で進捗と結果を返す（楽曲生成の job と同じ形）。
   - 入力: 学習データ（下の JSONL）、基本モデル、質問セットの id と版。
   - 出力: adapter の id と版、held-out の eval 分割での指標（正解率、型ごとの校正の指標、混同行列）。
3. **adapter の管理。**
   - adapter は版つきで、作ったあとは不変にする。
   - 一覧・詳細・削除の API を用意する。
   - 要求の本文で `adapter` を指定したらそれを使い、指定がなければ基本モデルを使う。
   - 存在しない adapter や、質問セットと合わない adapter は、決まったエラーコードで拒否する。
4. **学習データの扱い。**
   - 学習データとラベルは、利用側が削除できるようにする。
   - state・質問・ラベルの本文をログに出さない。
   - 認証は Control Bearer とし、Idempotency-Key を使う。

学習データの形式（提案。LARM 側で改めてよい）:

```json
{"id":"case-0001","task":"task-017","split":"train","questionSetId":"pursuit-guards","questionSetVersion":3,"questionId":"scope_expanding","state":{"...":"..."},"label":true}
{"id":"case-0002","task":"task-021","split":"eval","questionSetId":"pursuit-guards","questionSetVersion":3,"questionId":"trajectory","state":{"...":"..."},"label":"thrashing"}
```

- `label` は型に合わせる（`noul` は真偽、`choice` は選択肢名、`score` は段階の番号）。
- `split` は `train` / `calibration` / `eval`。分割は利用側が**課題単位**で行う。LARM 側で混ぜ直さない。

### R4 catalog の説明

`services` と同じように、Provider に `description` を付ける。次のことが catalog だけで分かるようにする。

- 要求と応答の形
- 上限
- adapter の指定方法
- 学習・adapter 管理の API の場所

## 範囲外

- 判定の閾値の校正。確率は利用側で校正する。
- Eumenes のコードの変更。
- 既存の判断 Provider の置き換え。

## 受入条件

1. catalog に汎用の判断 Provider が載り、`description` から要求と応答の形・上限・adapter の使い方が分かる。
2. Agent Connection を確保し、`noul` / `choice` / `score` を混ぜた10問以上を1要求で送ると、質問ごとに型どおりの答えが返る。
3. 日本語と英語の基準文での比較結果が報告されている。
4. 小さな学習データ（質問1つ、数百件）で学習 job が完了し、adapter の id・版と eval 指標が返る。その adapter を指定した要求と、指定しない要求の両方が動く。
5. adapter と学習データを削除でき、削除した adapter を指定した要求は決まったエラーコードで拒否される。
6. 既存の `decision.system-one` と `decision.game` を使う要求の結果が変わらない。
7. 会話 profile と実行基盤を共有する場合は、確保と学習が会話に与える影響が測られ、報告されている。

## 報告してほしいこと

- 決めた capability・protocol・endpoint・profile の性質（名前ではなく、選び方）
- 要求・応答・エラーの schema、上限
- 日本語の測定結果
- 選んだ調整方法とその根拠、学習にかかる時間と資源
- 会話への影響の測定結果
- できなかったこと、代わりの案
