# 失敗の傾向: reflect-2

| 課題 | 段階 | 条件 | 結末 | 最後に落ちた基準 | 申告の不合格 | 拒否 | 一段上へ | 道具 | 費用 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h4-bertrand | T0 | E3 | verified | - | 1 | judge_necessary×4 claim_not_verified×1 invalid_proposal×1 reread_required×1 | 2 | write_proof×6 read_proof×3 check_tex×1 | $0.080 |
| h4-bertrand | T0 | E3 | stopped_by_review | - | 1 | invalid_proposal×6 reread_required×2 claim_not_verified×1 | 4 | write_proof×10 check_tex×3 read_proof×5 | $0.109 |
| h4-bertrand | T0 | E3 | gave_up | proof-sound | 2 | invalid_proposal×3 reread_required×1 claim_not_verified×2 | 6 | write_proof×19 read_proof×6 check_tex×6 | $0.191 |
| h4-bertrand | T0 | E3 | forced_stop | - | 1 | invalid_proposal×11 judge_necessary×4 claim_not_verified×1 reread_required×1 | 8 | write_proof×18 check_tex×2 read_proof×7 | $0.180 |
| h4-bertrand | T0 | E3 | verified | - | 0 | invalid_proposal×6 | 1 | write_proof×3 check_tex×2 read_proof×1 | $0.022 |
| h4-bertrand | T0 | E3 | verified | - | 1 | invalid_proposal×6 claim_not_verified×1 reread_required×1 | 3 | write_proof×11 check_tex×3 read_proof×3 | $0.104 |
| h4-bertrand | T0 | E3 | gave_up | - | 2 | invalid_proposal×9 judge_necessary×4 claim_not_verified×2 strategy_not_exhausted×1 | 7 | write_proof×11 check_tex×5 read_proof×7 | $0.150 |
| h4-bertrand | T0 | E3 | forced_stop | - | 2 | invalid_proposal×5 claim_not_verified×2 | 7 | write_proof×22 check_tex×2 read_proof×6 | $0.233 |
| h4-ln2-irrational | T0 | E3 | verified | - | 0 | judge_necessary×1 | 0 | write_proof×1 read_proof×1 | $0.015 |
| h4-ln2-irrational | T0 | E3 | verified | - | 0 | - | 1 | write_proof×2 read_proof×2 check_tex×2 | $0.035 |
| h4-ln2-irrational | T0 | E3 | verified | - | 0 | reread_required×1 | 4 | write_proof×7 read_proof×3 check_tex×4 | $0.088 |
| h4-ln2-irrational | T0 | E3 | stopped_by_review | proof-sound | 0 | reread_required×4 strategy_not_exhausted×5 | 7 | write_proof×4 read_proof×5 check_tex×1 | $0.117 |
| h4-ln2-irrational | T0 | E3 | gave_up | proof-sound | 0 | reread_required×3 invalid_proposal×1 strategy_not_exhausted×3 | 8 | write_proof×3 check_tex×1 read_proof×4 | $0.119 |
| h4-ln2-irrational | T0 | E3 | verified | - | 0 | reread_required×1 judge_necessary×1 | 3 | write_proof×2 check_tex×1 read_proof×2 | $0.054 |
| h4-ln2-irrational | T0 | E3 | gave_up | proof-sound | 0 | reread_required×4 strategy_not_exhausted×1 | 7 | write_proof×5 check_tex×1 read_proof×4 | $0.114 |
| h4-ln2-irrational | T0 | E3 | verified | - | 0 | reread_required×1 | 3 | read_proof×3(err1) write_proof×5 check_tex×1 | $0.075 |
| h4-ln2-irrational | T0 | E3 | verified | - | 0 | - | 0 | write_proof×2 check_tex×1 read_proof×1 | $0.018 |
| h4-ln2-irrational | T0 | E3 | verified | - | 0 | reread_required×3 | 5 | write_proof×10 check_tex×3 read_proof×4 | $0.108 |
| h4-ln2-irrational | T0 | E3 | gave_up | proof-sound | 0 | reread_required×1 strategy_not_exhausted×6 | 8 | write_proof×4 read_proof×4 | $0.123 |
| h4-ln2-irrational | T0 | E3 | gave_up | proof-sound | 0 | reread_required×2 strategy_not_exhausted×9 | 8 | write_proof×3 read_proof×5 check_tex×1 | $0.124 |
| h4-ln2-irrational | T0 | E3 | gave_up | - | 0 | reread_required×3 strategy_not_exhausted×3 | 8 | write_proof×7 check_tex×2 read_proof×6 | $0.166 |
| h4-ln2-irrational | T0 | E3 | stopped_by_review | proof-sound | 0 | reread_required×2 strategy_not_exhausted×3 | 6 | write_proof×2 read_proof×2 | $0.076 |
| h4-ln2-irrational | T0 | E3 | gave_up | proof-sound | 0 | reread_required×2 strategy_not_exhausted×8 | 8 | read_proof×4(err1) write_proof×2 check_tex×1 | $0.109 |
| h4-ln2-irrational | T0 | E3 | stopped_by_review | - | 0 | reread_required×5 strategy_not_exhausted×6 | 8 | write_proof×8 read_proof×6 check_tex×1 | $0.177 |

## 結末の分類
- verified: 10
- gave_up: 8
- stopped_by_review: 4
- forced_stop: 2

## 最後に落ちた基準
- proof-sound: 8

## 方針の一覧
### h4-bertrand generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim #1（gave_up）
- 方針1: Erdős型の証明を採用する。中心二項係数C(2n,n)の素因数分解に対するLegendre公式による上界と、4^n/(2n+1)による下界を比べ、n<p≤2nの素数がないと仮定して矛盾を導く。小さいnは素数表で個別に確認する。
- 方針2: 閾値Nを先に明示的に固定し、有限の確認範囲を素数の鎖で一度に閉じる方針に切り替える。中心二項係数C(2n,n)のLegendre公式による上界と4^n/(2n+1)による下界を比べ、n≥Nでは背理法で矛盾を出す。n<Nは素数の列を手で並べて個別に確認する。素数定理は使わず、全n≥1を覆う論証構造として組み直す。
- 方針3: 閾値比較を一括で行う従来の構成を捨て、中心二項係数の素因数評価を素数の区間ごとに分けて上から抑え、n<p≤2n の素数の積が C(2n,n) より真に大きいことを示す背理法に組み直す。大きい n は単調な不等式で覆い、小さい n は素数の列で個別に閉じる。
### h4-bertrand generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim #2（forced_stop）
- 方針1: Erdős型の初等的証明を採る。中心二項係数 C(2n,n) の素因数分解を評価し、n<p≤2n の素数が存在しないと仮定すると C(2n,n) が小さすぎることを示して矛盾を導く。
- 方針2: 前提を見直し、Erdős型の評価を検証可能な小さな主張に分け直して順に確定させる。(a) 上界 C(2m,m) ≤ 4^m から θ(x) < x log 4 を得る、(b) C(2n,n) ≥ 4^n/(2n+1) を最大項の議論で示す、(c) Legendre の公式で素数べきの寄与を評価する、(d) 仮定の下で上
- 方針3: Erdős型の評価を維持しつつ、(n,2n]の素数の不在を仮定した上限・下限の比較を、各補題を独立に確定させる順序で組み直す。
### h4-bertrand generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim #3（verified）
- 方針1: Erdős型の初等的証明を採用する。中心二項係数 C(2n,n) の素因数分解に Legendre の公式を当て、n < p ≤ 2n の素因数が無いと仮定して C(2n,n) の上界と下界を比べて矛盾を導く。素数定理は使わず、初等評価のみで完結させる。
### h4-bertrand generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim #4（stopped_by_review）
- 方針1: エルデシュ流の初等的証明を採る。中心二項係数 C(2n,n) の下からの評価と、素因数の指数の上からの評価を比べ、n<p≤2n の素数がないと仮定すると矛盾することを示す。
- 方針2: 方針を見直し、エルデシュ流の骨格は維持しつつ、対数と e を使わず有理数と整数の不等式だけで比較を行う。仮定（n<p≤2nの素数がない）から出発し、C(2n,n)の下界4^n≤(2n+1)C(2n,n)と、Legendreの公式で得る上界C(2n,n)≤(2n)^{√(2n)}·4^{2n/3}を用意する。両者から4^
### h4-bertrand generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #1（verified）
- 方針1: Erdősの初等証明に沿い、中心二項係数 C(2n,n) を素因数分解の両側から評価して矛盾を導く。n<p≤2n の素数が無いと仮定すると、C(2n,n) の上界が下界 4^n/(2n+1) を下回ることを示す。
- 方針2: Erdős型の枠組み（中心二項係数の下界と上界の比較）は保つが、大きい n の不等式は単調性の議論に頼らず、帰納法で直接示す。小さい n は素数列の隣接比で手計算により確認する範囲を先に決め、その範囲の境界で両者を接続して矛盾を導く。
### h4-bertrand generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #2（verified）
- 方針1: Erdősの初等証明に沿って、中心二項係数 C(2n,n) の素因数分解を評価し、「n<p≤2n の素数がない」と仮定して矛盾を導く。大きい n では下からの評価と上からの評価が両立しないことを示し、小さい n は素数の列を直接確認して片づける。
### h4-bertrand generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #3（forced_stop）
- 方針1: Erdősの初等的証明の方針をとる。中心二項係数 C(2n,n) の素因数分解（Legendreの公式）を上から評価し、下からは 4^n/(2n+1) ≤ C(2n,n) で押さえ、n<p≤2n の素数が無いと仮定すると両者が矛盾することを示す。小さい n は手計算で確認し、大きい n は評価で処理する。
- 方針2: 方針2（θ型の対数和による評価）：C(2n,n) を素因数の積として直接扱う代わりに、∏_{n<p≤2n} p が C(2n,n) を割り切ることから、仮定「n<p≤2n の素数は存在しない」のもとで C(2n,n) の素因数の総和を θ(x)=Σ_{p≤x} log p の形で評価し、下界 4^n/(2n+1) と比
- 方針3: 方針3: Erdős型の矛盾証明を維持しつつ、C(2n,n)の素因数の寄与を三つの区間（√(2n)以下、√(2n)超2n/3以下、2n/3超n以下）に分けて評価し、上界と下界の比較を一本の不等式に集約する。組版確認ではなく、各不等式の適用条件と数値の確認を進捗の基準にする。
### h4-bertrand generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #4（gave_up）
- 方針1: Erdősの初等的証明に倣い、中心二項係数C(2n,n)の素因数分解を使って矛盾を導く。区間(n,2n]に素数がないと仮定し、C(2n,n)の上界と下界を比較する。
- 方針2: Erdős型の評価を維持しつつ、上界を「√(2n)以下の素数の寄与」と「√(2n)より大きい素数の寄与」に分けるのをやめ、ϑ関数（Chebyshev関数）の上界 ϑ(x) < 2x log 2 を先に一般のxで示してから比較する。小さいnは別途手計算で個別に確認し、大きいnだけを漸近評価で扱う。
- 方針3: Erdős型の中心二項係数の議論を捨てず、検証の主軸を形式チェックから論理の完全性に移す。具体的には、Legendreの公式による指数の評価、C(2n,n)の上界と下界、大きいnでの矛盾、n≤630の個別確認の四つの接続点を、各不等式の前提と適用範囲（特にnの下限）を明示して循環なく閉じることを最優先とする。check
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim #1（verified）
- 方針1: ln2=a/bと仮定し、I_n=∫_0^1 x^n(1-x)^n/(1+x)dxを用いて、b·d_{n+1}·I_nが正の整数でありながら0へ収束することを示して矛盾を導く（Nair型の積分法）
- 方針2: 重み多項式を x^n(1-x)^n/(1+x) から変え、Legendre型の高階導関数で与えられる重み P_n(x)=(1/n!)d^n/dx^n[x^n(1-x)^n] を用いる。ln2=a/b と仮定し、整数係数の線形形式 b·(有理部分)−a·(対数部分) が正の整数でありながら 0 へ収束することを、分母を 
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim #2（gave_up）
- 方針1: 背理法で進める。ln 2 = a/b と仮定し、整数係数の多項式を重みにした積分 I_n を作る。I_n は一方で 0 < I_n < 1 に近い小さな正数として評価でき、他方で b·D_n·I_n が非零整数になるように分母 D_n を取れることを示して矛盾を導く。
- 方針2: 重み関数を x^n(1-x)^n/(1+x) から、分母の次数を上げた x^n(1-x)^n/(1+x)^{n+1} に替える。ln 2 を 1/(1+x) の積分で表し、J_n の部分分数分解で ln 2 の係数と有理数部分を分け、ln 2 = a/b の仮定から整数列の非零性と小ささの矛盾を導く。
- 方針3: 従来の重み x^n(1-x)^n と分母の増大の比較を捨て、Hermite–Padé 型の二重積分（Beukers 型）で ln2 の有理近似列を新たに構成する。整数係数の近似 A_n, B_n を作り、B_n ln2 − A_n の指数的な減少と、分母の lcm の冪による整数化の成長を比べて、非零整数が 1 未満に
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim #3（verified）
- 方針1: 背理法で ln 2 = p/q（p, q は整数, q ≥ 1）と仮定し、I_n = ∫_0^1 x^n(1-x)^n/(1+x) dx という積分を使って、d_n^3 を掛けると整数になるのに 0 と 1 の間に入るという矛盾を導く（Nair 型の証明）。
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim #4（stopped_by_review）
- 方針1: ln 2 = a/b と仮定し、整数 n に対して I_n = ∫_0^1 x^n(1-x)^n/(1+x) dx を考える。I_n は一方で ln 2 の有理数倍と有理数の和として表され、もう一方で正かつ 1 より十分小さい。その矛盾を、d_n ≤ 3^n を用いて分母の評価から導く。
- 方針2: 重み関数の族を x^n(1-x)^n/(1+x) から指数を分けた二変数族 J_{m,n} に替え、分母の増加より速く減衰する積分表示で矛盾を作る。ただし減衰の不等式は未検証で、成立しない可能性がある。
- 方針3: 重み x^n(1-x)^n/(1+x) の族を捨て、t=1+x と置いて K_n=∫_1^2 (t-1)^n(2-t)^n t^{-n-1} dt を用いる。(t-1)(2-t)/t の最大値 3-2√2 により 0<K_n≤(3-2√2)^n ln2 を得て、分母を d_{n+1} のみで抑え、2^n の余分な因子を
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim #5（verified）
- 方針1: ln2=a/b と仮定し、整数 b·d_N·I_n が正で1未満になる矛盾を導く（Beukers型の積分 I_n = ∫_0^1 x^n(1-x)^n/(1+x)^{n+1} dx を用いる）
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim #6（gave_up）
- 方針1: 背理法で ln 2 = a/b（a,b は正の整数）と仮定し、x^n(1-x)^n/(1+x) の積分 I_n を用いて、有理数部分の分母が d_n で抑えられる一方で I_n が d_n 側より速く 0 に近づくことを示し、矛盾を導く。
- 方針2: 前提を見直し、重みを x^n(1-x)^n/n! 型の多項式にそろえた積分族へ切り替える。分母の増大を d_n ≤ 3^n の指数で抑え、積分の減衰が勝つ不等式を組んで 0<N<1 の矛盾を導く。
- 方針3: 従来の重み x^n(1-x)^n 族は捨て、ln 2 を交代調和級数の部分和で近似したときの誤差を直接扱う。さらに、整数係数の線形形式 L_n = b·(整数係数の有理近似) − a·(対応する係数) を構成し、L_n が 0 でない整数であることと、|L_n| が 1 より小さく 0 に近づくことを同時に示して矛盾を
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim #7（verified）
- 方針1: ln 2 = a/b と仮定し、積分 J_n = (1/n!)∫_0^1 x^n(1-x)^n/(1+x) dx を用いて、適切な整数倍が「正で 1 より小さい整数」になることを示す背理法で矛盾を導く（Niven型の多項式積分法）。
- 方針2: 従来の積分重み x^n(1-x)^n/(1+x) による整数化の枠組みを捨て、ln 2 の既知の級数表示 ln 2 = Σ (-1)^{k+1}/k に基づく Padé 型の有理近似へ切り替える。整数係数の近似 P_n/Q_n を具体的に構成し、整数化後の誤差が 1 未満の正の整数という矛盾を導く。
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim #8（verified）
- 方針1: Nivenの方法の変形（Erdős型の整数列による反証）：ln 2 が有理数 a/b と仮定し、整数 n に依存する補助整数 N_n > 0 と小さな正の量 ε_n を構成して、0 < N_n·(a/b·something − ...) < 1 となる矛盾を導く。具体的には I_n = ∫_0^1 x^n(1−x)^n
- 方針2: 既存の I_n 型積分（重み x^n(1−x)^n/(1+x)）の減衰率が分母 d_{2n} の増大に負ける問題を捨て、Beukers 型のルジャンドル多項式族 P_n(x)=(1/n!)(d/dx)^n(x^n(1−x)^n) を用いる。ln 2 = a/b と仮定し、整数係数の一次形式 A_n − B_n ln 2
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #1（verified）
- 方針1: 背理法で ln 2 = a/b（a,b は正の整数）と仮定し、補助積分 I_n = ∫_0^1 x^n(1-x)^n/(n!(1+x)) dx を使って、整数倍すると非零の整数になるが同時に 1 より小さくなる列を作って矛盾を導くディオファントス近似型の証明を採る。
- 方針2: 前提を見直し、分母を d_{n+1} 程度に抑える補助積分の構成に切り替える。ln 2=a/b と仮定し、整数係数の補助多項式 R_n(x) を使った積分 J_n=∫_0^1 R_n(x)/(1+x) dx が、有理数部分と ln 2 の線形結合として書けることを示す。その後、b と d_{n+1} の累乗を掛けた量が
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #2（gave_up）
- 方針1: 背理法で ln 2 = a/b（a,b は正の整数）と仮定し、x^n(1-x)^n/(1+x) の積分 I_n を用いて、整数係数の表示と小ささの評価を組み合わせて矛盾を導く。
- 方針2: 前提を見直し、積分族の分母の冪と正規化を変える。ln 2 を 1/(1+x) 型の積分で近似する従来の方針は、大きさの評価が d_n の増大に負けて閉じなかった。そこで、整数係数の多項式による Padé 型の近似族を新たに作り、正規化因子に d_n^3 を取ることで、整数性と上界 1 未満の両立を狙う。
- 方針3: 従来の積分族の重み変更をやめ、ln 2 の近似誤差の指数と分母 d_N の増大指数を同じ変数で比べる別構成に移る。具体的には、ln 2 = a/b と仮定し、整数係数の多項式 P_n(x) を用いた積分 I_n = ∫_0^1 P_n(x)/(1+x) dx を、分母次数 N(n) を明示した上で定義する。整数性は b
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #3（gave_up）
- 方針1: ln 2 = a/b と仮定し、ln 2 を含む積分 I_n = ∫_0^1 x^n(1-x)^n/(1+x) dx を使って背理法で矛盾を導く（Nair 型の積分論法）。
- 方針2: Nair型の積分論法は捨て、ln 2 の連分数展開（Lambert型）の近似分数の分母増大から背理法で矛盾を導く。ln 2 = a/b と仮定し、近似分数 p_k/q_k について N_k = a q_k − b p_k が非零整数で、かつ |N_k| → 0 となることを示す。
- 方針3: Nair型の積分論法は、重みの次数と分母の正規化（d_{2n} の掛け方）を変えて組み直す。ln 2 = a/b と仮定し、b·d^3·I_n が非零整数になり、かつ 0 と 1 の間に入る評価を示す。
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #4（verified）
- 方針1: ln 2 = a/b と仮定し、整数係数の積分量 I_n を用いて矛盾を導く背理法（Legendre 型多項式による有理近似）を採る。
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #5（gave_up）
- 方針1: ln2=a/bと仮定し、x^n(1-x)^n/(1+x)の積分I_nを使って、整数係数の矛盾を導く（Niven型の積分法）。
- 方針2: ln2を有理数近似列の連分数（Euler型の連分数展開）として扱い、近似の分母が整数になる漸化式と、誤差の非零性・縮小性を組み合わせて、ln2=a/bとした場合に0と1の間の非零整数が生じることを示す。重みつき積分の乗数合わせは使わない。
- 方針3: 従来の積分法とEuler型連分数を捨て、Lambert型連分数（artanh 経由で ln 2 を表す展開）に基づく有理近似列を用いる。ln 2=a/b と仮定し、近似の分母・分子が整数になることを示したうえで、誤差の非零性と大きさを比べて、0 と 1 の間の非零整数を導く。まず誤差と分母の増減を先に比べ、その比較が成
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #6（stopped_by_review）
- 方針1: 背理法で ln 2 = a/b（a, b は正の整数）と仮定し、積分 I_n = ∫_0^1 x^n(1-x)^n/(1+x) dx を用いて、適切な整数倍が「正で1未満に収束する整数列」となる矛盾を導く（Niven型の証明）。
- 方針2: Beta型の重み積分による上界評価（d_n ≤ 3^n と減衰 4^{-n} の比較）は、この設計では1未満に収まらないと確認されたため放棄する。代わりに、ln 2 = a/b と仮定したうえで、Hermite–Padé型の有理近似を n! と d_n による整数化で構成し、誤差項の絶対値が n→∞ で1未満に落ちるこ
- 方針3: 前提を見直し、Beta重みの方針を捨てて、ln(1+x) の Hermite–Padé 型有理近似で証明する。多項式の次数と分母の冪を独立なパラメータとして取り、誤差項の指数比を先に手計算で確かめてから組み立てる。
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #7（gave_up）
- 方針1: ln 2 = p/q と仮定し、I_n = ∫_0^1 x^n(1-x)^n/(n!(1+x)) dx を用いて、d_n の冪で整数化した量が 0 と 1 の間に入るという矛盾を導く。
- 方針2: 積分の被積分関数を x^n(1-x)^n/(1+x) とする方針を捨て、ln 2 の交代級数（Mercator 級数）の部分和の誤差を用いる Niven 型、または Padé 近似を使う Hata 型の線形形式の矛盾へ切り替える。まず ln 2 = p/q と仮定し、整数係数の補助量と小さい線形形式を作って、分母の増大
- 方針3: ln2 = a/b と仮定し、Niven型の交代級数（Mercator級数）の部分和誤差を使う。整数になる補助量 N_k を定め、0 < N_k < 1 を示して矛盾を導く。分母は n! で一括して扱い、d_n ≤ 3^n の範囲で分母の増大と上界の減衰が順方向になるかを、評価に入る前に手計算で確かめる。
### h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #8（stopped_by_review）
- 方針1: Lambert型ではなく、Niven型の積分による背理法で示す。ln 2 = a/b と仮定し、I_n = ∫_0^1 x^n(1-x)^n/(1+x) dx を用いる。I_n は正で上から小さく抑えられる。一方、多項式除法により I_n は有理数部分と (-1)^n 2^n ln 2 の和として書け、b·d_{2n+
- 方針2: ln 2 = a/b と仮定し、重み積分の指数比較を見直す。一様な重み x^n(1-x)^n 系では分母増大 e^2 と誤差 4^{-1} の比が1を超えず矛盾が出ないことを先に確定させる。そのうえで、分母と誤差の比較を精密化するため、Nair 型の重み積分（1/(1+x) を含む形）の分母評価を、d_{2n+1} の

## 追求あたりの方針の数
| 課題 × 構成 | 平均 | 内訳 |
| --- | --- | --- |
| h4-bertrand generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim | 2.3 | 3 3 1 2 |
| h4-bertrand generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 2.3 | 2 1 3 3 |
| h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim | 2.1 | 2 3 1 3 1 3 2 2 |
| h4-ln2-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 2.5 | 2 3 3 1 3 3 3 2 |

## 深さと部分点
| 課題 | 条件 | 構成 | n | 照合を通過 | 95% 区間 | 部分点 | 証明を書いた回数 | 方針の数 | 方針1 での試行 | 断念 / 停止 | 申告（通過 / 全体） | 申告漏れ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| h4-bertrand | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 4 | 2 | 15–85% | 1.00 | 11.75 | 2.25 | 9.75 | 1 / 0 | 2 / 7 | 2 |
| h4-bertrand | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim | 4 | 1 | 5–70% | 0.96 | 13.25 | 2.25 | 11.75 | 1 / 1 | 1 / 6 | 2 |
| h4-ln2-irrational | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 8 | 2 | 7–59% | 0.53 | 4.75 | 2.50 | 3.75 | 4 / 2 | 2 / 2 | 2 |
| h4-ln2-irrational | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance/L-pi2-claim | 8 | 5 | 31–86% | 0.70 | 3.63 | 2.13 | 3.75 | 2 / 1 | 5 / 5 | 0 |
