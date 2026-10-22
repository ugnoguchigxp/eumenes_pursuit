#!/usr/bin/env bash
# Monthly sales report: input/ -> build/sales.db -> out/report.txt
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build out
rm -f build/sales.db
python3 stage1_import.py input build/sales.db
python3 stage2_steps.py sql build/sales.db
python3 stage3_dedupe.py build/sales.db
python3 stage4_report.py build/sales.db out/report.txt
echo "report: out/report.txt"
