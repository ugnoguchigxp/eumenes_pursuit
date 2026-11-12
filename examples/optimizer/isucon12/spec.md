# ISUCON12 予選のランキング

競技ランキングの読み出しを担当する `ranking.ts` を高速化してください。変更できるファイルは `ranking.ts` です。実行環境は Bun と SQLite です。

`rank(db, tenantId, competitionId, rankAfter, revision)` は SQLite の次のテーブルを参照し、対象の大会の順位表を返します。同期関数、非同期関数のどちらでも構いません。

- `player(tenant_id, id, display_name)`。主キーは `(tenant_id, id)`。
- `player_score(tenant_id, competition_id, player_id, score, row_num)`。`row_num` は入稿データ内の1始まりの行番号です。初期インデックスは `(tenant_id, competition_id, row_num DESC)`。

同一参加者のスコアが複数ある場合、対象の大会で最後に現れた行を使います。得点の降順に並べ、同点なら採用した行の番号が小さい方を先にします。順位は1始まりで、同点でも順位は重複しません。`rankAfter` は0以上の整数で、その順位より後の最大100件を `{ rank, score, player_id, player_display_name }` の配列で返します。該当行がなければ空配列を返します。

同じDB接続に複数のリクエストが来ます。再入稿は対象テナントと大会のスコアを全置換します。`revision` はそのテナント・大会への入稿回数です。他のテナントや大会に同じID・版番号が存在します。参加者の表示名は試行中に変わりません。テーブルの更新と計測は採点器が担当します。

開発用の計測は負荷ごとに144件、最終検証は192件の照会です。SQLiteの初期化、入稿、照会と結果出力を含めて計測します。最後は、入力を変えた独立監査で順位と速度を確認します。
