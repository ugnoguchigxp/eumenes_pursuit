# 限界付近の課題（数学・物理・化学）

基礎モデルの限界を調べるための3課題。どれも「標準入力の問いに答えるプログラムを書く」形で、入力は段階に分かれる（Solver は6段階、Optimizer は5段階）。段階が進むごとに別の着想が必要になるので、通過した段階から途中のアプローチを読み取れる。

| 課題 | 分野 | 段階ごとに必要になること |
| --- | --- | --- |
| `bracelets` | 数学（数え上げ） | 1 全列挙 → 2 Burnside と転送行列 → 3 非対称な条件での軌道の数え方 → 4 10^18 までの n（素因数分解と行列冪） → 5 2n と互いに素でない法での割り算 → 6 色数が千を超える巡回行列（多項式環での冪と高速な乗算） |
| `ising-ring` | 物理（量子スピン系） | 1 厳密対角化 → 2 自由フェルミオン化 → 3 パリティで分かれる二つの境界条件と分配関数の射影、フラストレーション → 4 両セクターをまたぐ励起の数え方 → 5 倍精度を超える指数的に小さい準位差 → 6 長さ 10^9 の環（運動量を足し上げずに済む解析式） |
| `equilibrium` | 化学（溶液平衡） | 1 弱酸・弱塩基 → 2 桁の離れた多成分の種分化 → 3 固相の出現と消失 → 4 活量係数の自己無撞着な解 → 5 多数の固相候補と微量成分 → 6 成分16・固相60の系を時間内に解く頑健さと速さ |

各課題のディレクトリに参照解 `reference.py`（標準ライブラリのみ）がある。問題と正解は [generate.py](generate.py) が作る。丸めの境界に近い答え、作業精度や初期値で変わる答えは生成時に捨てる。化学は、物質収支・飽和指数・固相の量の符号を参照解とは別の手順で検算している。

## Solver（解かせる）

課題IDは `hz13-bracelets`、`hz13-ising-ring`、`hz13-equilibrium`（[登録](../horizon-frontier.ts)）。作業領域には仕様（`README.md`）と段階1の見本だけがあり、`solve.py` を一から書く。隠された検査は各段階2ファイルの計12件で、照合結果は「k/12 通過」として返る。

隠された検査は、リポジトリと作業領域の外に作る。種は記録に残さない値を使う。

```sh
python3 eval/tasks/e/frontier/build-secrets.py /path/to/secret-dir <seed>
bun eval/main.ts run --name frontier-1 --tasks hz13-bracelets,hz13-ising-ring,hz13-equilibrium \
  --conditions D0,productive --secret-dir /path/to/secret-dir ...
```

実行には隔離実行（Linux の `bwrap`・`prlimit`）が要る。

## Optimizer（直させる）

課題名は `bracelets`、`ising-ring`、`equilibrium`（[定義](../../../../examples/optimizer/frontier.ts)）。`all` には含めず、名前を指定して実行する。

```sh
bun examples/optimizer/run.ts inspect bracelets,ising-ring,equilibrium artifacts/optimizer-frontier/inspect-1
bun examples/optimizer/run.ts compare bracelets,ising-ring,equilibrium artifacts/optimizer-frontier/compare-1
```

初期版（[starters](../../../../examples/optimizer/starters/)）には、もっともらしいが誤った解法と、大きな入力で終わらない処理を入れてある。

| 課題 | 初期版の誤り | 初期版のボトルネック |
| --- | --- | --- |
| `bracelets` | 裏返しの固定点を A のまま数える（非対称で誤る）。2n の逆元を取る（互いに素でない法で失敗） | 回転 n 個を順に回し、行列冪を1乗ずつ掛ける |
| `ising-ring` | 反周期の運動量だけを使い、パリティの制約と符号つきのモードを無視する。準位差を一粒子エネルギーの最小値とする | 運動量ごとに円周率と余弦を級数で求め直す |
| `equilibrium` | 過飽和の固相を足すだけで外さない。活量係数を理想溶液のイオン強度で一度だけ補正する | ニュートン法の刻みを 0.05 に抑えている |

速度比較の基準版は初期版とは別の「正しいが遅い」実装で、モデルには見せない。開発用と独立監査用の入力は `examples/optimizer/frontier/<課題>/` にある。作り直すときは次を実行する。

```sh
python3 eval/tasks/e/frontier/generate.py <課題> <seed> examples/optimizer/frontier/<課題> --optimizer
```

## 難易度の位置づけ

狙いは、強いモデルが全段階を解け、その一つ下のモデルが上位の段階で止まる境界である。どのモデルがどの段階まで届くかは、実際に走らせて確かめる。境界がずれていた場合は、合否を見る段階を変える。

## 2026-11-13 の実測

各構成1回ずつ。数字は6段階のうち通過した段階数（段階内の隠し検査2件がともに一致）。

| 構成 | 数学 | 物理 | 化学 |
| --- | --- | --- | --- |
| gpt-6-luna low、直接解法（D0） | 0 | 0 | 2 相当（隠し検査 4/12） |
| gpt-6-luna low、productive | 1 | 1 | 2 |
| gpt-6-luna low＋上位レビュー gpt-6.1-sol high（`--advisor`） | 未測定 | 未測定 | 2（助言1回） |
| gpt-6.1-sol medium、productive | 6 | 6 | 6 |
| 素の Codex CLI、gpt-6.1-sol high（ハーネスなし） | 6 | 6 | 6 |

- 結果を分けたのは作業するモデルだった。gpt-6.1-sol はハーネスの有無にかかわらず全段階を通過し、gpt-6-luna low はハーネスや上位レビューを足しても段階2までだった。
- 上位レビューつきの実行は、助言の呼び出しがタイムアウトして費用の安全装置が働いたため、化学の1課題で終えた。化学では助言の検算例を実行したが、解法の作り直しには至らなかった。
- この3課題は gpt-6.1-sol には易しく、gpt-6-luna low には遠い。モデルが届くかどうかの境界でハーネスが効くかは、この実測では分からない。
- 検証と計測はここで終了した。原記録は手元の `eval/results/frontier-*` と `artifacts/frontier-20261113/` にある（リポジトリには含めていない）。
