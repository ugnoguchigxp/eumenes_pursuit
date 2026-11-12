# ISUCON12予選のランキングをmacOSで検証する

[ISUCON12予選の公式Node.js初期実装](https://github.com/isucon/isucon12-qualify/blob/95958774bde66d47fd26cc820fd2fbfbece798f1/webapp/node/src/main.ts#L1354-L1408) のランキングを、BunとSQLiteで動く `ranking.ts` に移植しました。適用される [MITライセンス](LICENSE) を同梱しています。元の全スコア行の読取りと参加者ごとに名前を引く処理を残しています。[公式の解説](https://isucon.net/archives/56850281.html)

認証、HTTP、閲覧履歴のMySQL書込みは省きます。CSVの入稿は固定データからSQLiteを更新して再現し、同一テナント・大会への再入稿回数を `revision` で渡します。[公式仕様](https://github.com/isucon/isucon12-qualify/blob/95958774bde66d47fd26cc820fd2fbfbece798f1/webapp/specification.md) のランキング節には最大スコアを採用する記載があります。この課題では初期実装と入稿節に従い、同一参加者には最後の行を採用します。

リポジトリのBun依存関係をインストール済みなら、macOSで追加サービスを起動せずに初期版を確認できます。候補のコードはネットワークを遮断した `sandbox-exec` 内で実行されます。

```sh
bun examples/optimizer/run.ts inspect isucon12-ranking artifacts/optimizer-isucon/inspect-1
bun test examples/optimizer/isucon12/fixture.test.ts
```

実モデルで1回試すには、Optimizerの既存のAPI設定と認証を使います。直接解法と比較する場合は `api` を `compare` に替え、別の出力先を指定してください。どちらも旧課題は実行しません。

```sh
bun examples/optimizer/run.ts api isucon12-ranking artifacts/optimizer-isucon/pilot-1
```

実行時間のばらつきが大きい環境では、課題名を `isucon12-ranking-sql` に替えると、同じ入力をSQLの実行回数で評価できます。採点器の入稿やSQLの準備は計数の対象外です。候補は順位を維持し、未使用データでも初期版より少ない実行回数で処理する必要があります。

採点器は再入稿、同点、ページ境界、別テナント・大会の応答を照合します。速度は2種類の144件の照会で候補と現行最良版を交互に測り、最後は未使用データで192件の照会を監査します。SQLiteの初期化、入稿、照会、結果出力を含めたローカル計測です。同一版の校正には負荷ごとに28組を使い、ばらつきが既存の上限を超えた場合はモデルを呼ぶ前に停止します。合格版、監査結果、使用量は出力先に保存されます。結果は切り出したランキング処理のローカル評価として解釈します。
