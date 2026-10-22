最終更新: 2025-02-10

# 入力の形

```json
{
  "run_date": "2025-12-31",
  "accounts": [
    {
      "id": "A100",
      "plan_history": [{"from": "2025-01-31", "plan": "BIZ"}, {"from": "2025-03-10", "plan": "pro-2025"}],
      "cycles": 4,
      "coupon": {"code": "SPRING", "percent": 15, "from": "2025-02-01", "cycles": 2},
      "credit_yen": 5000,
      "tax_exempt": false
    }
  ],
  "usage": [{"account": "A100", "date": "2025-02-03", "units": 700}]
}
```

- run_date … 請求処理を実行する日。
- plan_history … プランの履歴。各要素のプランは from の日（その日を含む）から次の要素の from の前日まで有効。最初の要素の from が契約開始日。
- cycles … 契約開始から何回分の請求期間を請求するか。
- coupon … 省略可。
- credit_yen … 前払いクレジットの残高（契約開始時点）。省略時 0。
- tax_exempt … 免税のアカウント。省略時 false。
- usage … 利用記録。units は会議室・ブースの利用単位数（0 以上の整数）。
