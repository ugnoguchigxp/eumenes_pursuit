# Eumenes の Web 調査をローカルで再現する

Pursuit を Eumenes と同じ入力形式、道具の契約、出典 ID と独立した受入検証で動かす。専用の SQLite とファイルを指定先に作る。Eumenes の稼働環境、設定、会話、採用版には接続しない。

```sh
bun examples/eumenes/run.ts fixture productive museum artifacts/example-museum
bun examples/eumenes/run.ts fixture legacy museum artifacts/example-legacy
bun test ./test/scenario/eumenes-example.test.ts
```

`technical,museum,denied,missing,conflict,cap` を指定できる。固定試験モードは検証用の資料・応答を使い、ネットワークや有料推論を使わない。実モデルで検証する場合は、Pursuit の単独実行用設定と API 認証を用意し、`fixture` を `api` に替える。Eumenes のサービスには接続しない。実モデルも Web の返却資料は同じ固定資料を使う。前版の `src` を最後の引数に指定して `legacy` を実行すると、その前版の engine と migration が使われる。結果を上書きしないよう、実行ごとに新しい出力先を指定する。

`events.jsonl` には開始・受領・採用を別々に記録する。モデル呼出しの用途、時間、トークンと、待機・Web・Markdownの時間を集計する。集計の時間は重なり得る。 `audit.json` には試行、取得本文、判断、検証、出典と下書きが入る。保存後のMarkdownは `report_draft.answer` と同じバイト列。取消後は公開しない。検証に実データを混ぜる場合は、出力ディレクトリを共有しないこと。

- `sync.ts` は Eumenes のソースから Web・再読・下書きの道具、資料と下書きの契約、独立検証、指示、ポリシー、Markdownのファイル名と書込み部分を取り込む。ソースのパスとSHA-256は [provenance.json](provenance.json)。取り込み時の作業木の内容を保存するため、記載した HEAD と完全一致するとは限らない。
- 実際の Web クライアント、Eumenes の共通推論キュー、Scratch、Docling は同梱しない。取得の応答と待機、保存先、外部推論の receipt は隔離したホストで置き換える。Markdown のバイト列とファイル名は取り込んだ `writeLocal` で作り、下書きのバージョンを採用してから結果を公開する。
- 実行は一調査一ホスト。別の出力先を使えば独立に実行できる。同じ保存先を複数のプロセスから同時に開かない。停止・再開の試験では `openExample` で同じ設定と保存先を開く。保存済み receipt は再実行しない。発行中に落ちて結果が不明な Web・モデル呼出しは自動再発行しない。隔離されたMarkdownファイルは同じIDで安全に書き直せる。

Eumenes ソースの更新を取り込む場合:

```sh
bun examples/eumenes/sync.ts /path/to/eumenes
bun run format
bun test ./test/scenario/eumenes-example.test.ts
```

## 実行中の補足（Steer）

`openExample` の `steering` に共有 Inbox、補足に使える入力バイト数、対象 Pursuit に結び付く出典と版を照合する `resolve` を渡すと、`productive` の次手判断に補足を渡せます。送信側は、起動後に返る `steeringTarget` の対象ID・世代と、確定済みの出典ID・版を使って Inbox に登録します。

補足本文は既存の次手判断の入力にだけ入り、資料として扱われます。送信済みか不明なバッチは自動再送せず、応答を保存・採用する時点と以後の操作で、使った出典の版を再確認します。受付の状態はメモリ上にあり、終了やホストの閉鎖で破棄されます。再開後は新しい世代を使います。

開発用に固定したパッケージは eumenes-steer 0.1.0、コミット `1250b20`、アーカイブ SHA-256 `1ca04b8bee9b839016a14987fc903282c1b57665eca1e89457681c3990f1e705` です。検証は `bun test ./test/scenario/eumenes-example.test.ts` または `bun run verify` で実行できます。[Steerの公開契約](https://github.com/ugnoguchigxp/eumenes_steer/tree/1250b20)
