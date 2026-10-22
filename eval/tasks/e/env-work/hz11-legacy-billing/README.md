# kumobill

KumoWorks（コワーキングスペース）の月額請求書を作るツール。請求の依頼（JSON）を標準入力から読み、請求期間ごとに 1 行ずつ出力する。

```
python3 -m kumobill < request.json
python3 -m unittest discover -s tests
```

## 仕様のありか
- docs/cycles.md … 請求期間
- docs/pricing.md … 基本料金・日割り・超過料金
- docs/discounts.md … クーポン割引・前払いクレジット
- docs/tax.md … 消費税
- docs/legacy-codes.md … 旧予約システムのプランコード
- docs/input.md … 入力の形
- CHANGELOG.md … 変更の記録

各ページの先頭に最終更新日がある。記述が食い違うときは、日付の新しい記述が正しい（CHANGELOG の各項目の日付も同じ扱い）。

## 出力
請求期間ごとに次の 1 行（金額はすべて円の整数）。

```
<アカウントID> <期間の初日>..<期間の最終日> plan=<プラン> base=<基本料金> overage=<超過料金> discount=<割引> tax=<消費税> credit=<充当したクレジット> total=<請求額> carry=<繰り越すクレジット残高>
```

- plan は、請求期間の最終日に有効なプラン（旧コードはカタログのコードに読み替えたもの）。
- アカウントは入力の順に、各アカウントの請求期間は古い順に出力する。

## プランのカタログ
data/plans.json。
