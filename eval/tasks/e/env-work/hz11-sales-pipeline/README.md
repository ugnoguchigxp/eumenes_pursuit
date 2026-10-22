# 月次売上レポート

4 支店（東京・大阪・札幌・ホノルル）のレジの書き出し（input/）から、支店ごと・月ごとの売上と、支店ごとの売上 1 位のカテゴリを出す。

```
bash build.sh        # → out/report.txt
```

## 段階
1. stage1_import.py … input/<支店>/*.csv と input/rates.csv を build/sales.db に読み込む
2. stage2_steps.py … sql/ の SQL ステップを実行する（docs/sql-steps.md）
3. stage3_dedupe.py … 書き出しの重なりで二重に入った行を落とす
4. stage4_report.py … out/report.txt を書く（docs/report.md）

## 入力
- input/branches.json … 支店ごとの書き出しの形式（docs/branches.md）
- input/<支店>/sales_*.csv … レジの書き出し（見出し: receipt_no, sold_at, category, amount）
  amount はどの支店でも正の値で、返品・取消はこの書き出しに含まれない（負の金額の丸めは扱わない）。
- input/rates.csv … 月ごとの USD/JPY レート

仕様は docs/ にある。
