# 失敗の傾向: math-3s

| 課題 | 段階 | 条件 | 結末 | 最後に落ちた基準 | 申告の不合格 | 拒否 | 一段上へ | 道具 | 費用 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| e4-pi-squared-irrational | T0 | E3 | gave_up | proof-sound | 1 | judge_necessary×1 claim_not_verified×1 | 3 | write_proof×1 check_tex×1 | $0.028 |
| e4-pi-squared-irrational | T0 | E3 | gave_up | proof-sound | 0 | - | 5 | write_proof×3 check_tex×1 | $0.044 |
| e4-pi-squared-irrational | T0 | E3 | gave_up | proof-sound | 1 | claim_not_verified×1 | 0 | write_proof×1 check_tex×1 | $0.012 |
| e4-pi-squared-irrational | T1 | E3 | gave_up | proof-sound | 1 | claim_not_verified×1 | 0 | write_proof×2 check_tex×2 | $0.014 |
| e4-pi-squared-irrational | T1 | E3 | gave_up | proof-sound | 1 | claim_not_verified×1 | 1 | write_proof×1 check_tex×1 read_proof×1 | $0.017 |
| e4-pi-squared-irrational | T1 | E3 | gave_up | proof-sound | 0 | - | 2 | write_proof×1 check_tex×1 | $0.019 |
| e4-pi-squared-irrational | T2 | E3 | verified | - | 0 | - | 1 | search_reference×2 write_proof×1 | $0.014 |
| e4-pi-squared-irrational | T2 | E3 | gave_up | tex-valid, proof-sound | 0 | - | 3 | search_reference×2 read_reference×1 | $0.028 |
| e4-pi-squared-irrational | T2 | E3 | gave_up | proof-sound | 1 | judge_necessary×1 claim_not_verified×1 | 2 | search_reference×2 write_proof×1 read_proof×1 check_tex×1 | $0.020 |
| e4-pi-squared-irrational | T3 | E3 | gave_up | proof-sound | 0 | - | 0 | write_proof×1 search_reference×1 | $0.010 |
| e4-pi-squared-irrational | T3 | E3 | gave_up | tex-valid, proof-sound | 0 | - | 4 | search_reference×4 read_reference×1 calc×2 | $0.027 |
| e4-pi-squared-irrational | T3 | E3 | gave_up | tex-valid, proof-sound | 0 | - | 1 | search_reference×2 | $0.012 |
| e4-zeta3-irrational | T0 | E3 | stopped_by_review | proof-sound | 0 | - | 5 | write_proof×5 check_tex×2 | $0.046 |
| e4-zeta3-irrational | T0 | E3 | gave_up | tex-valid, proof-sound | 0 | - | 0 | read_proof×1(err1) | $0.006 |
| e4-zeta3-irrational | T0 | E3 | gave_up | proof-sound | 0 | - | 4 | read_proof×1(err1) write_proof×2 check_tex×2 | $0.036 |
| e4-zeta3-irrational | T1 | E3 | gave_up | tex-valid, proof-sound | 0 | - | 0 | calc×1 | $0.012 |
| e4-zeta3-irrational | T1 | E3 | gave_up | tex-valid, proof-sound | 0 | - | 5 | calc×6 | $0.042 |
| e4-zeta3-irrational | T1 | E3 | gave_up | tex-valid, proof-sound | 0 | - | 5 | calc×6 | $0.036 |
| e4-zeta3-irrational | T2 | E3 | stopped_by_review | tex-valid, proof-sound | 0 | - | 6 | calc×8 search_reference×2 | $0.036 |
| e4-zeta3-irrational | T2 | E3 | gave_up | tex-valid, proof-sound | 0 | - | 1 | search_reference×2 read_reference×2 | $0.014 |
| e4-zeta3-irrational | T2 | E3 | gave_up | tex-valid, proof-sound | 0 | judge_necessary×1 | 4 | search_reference×4 calc×3 read_reference×1 | $0.035 |
| e4-zeta3-irrational | T3 | E3 | gave_up | proof-sound | 0 | invalid_proposal×2 judge_necessary×2 | 1 | search_reference×2 read_reference×1 write_proof×1 | $0.031 |
| e4-zeta3-irrational | T3 | E3 | gave_up | proof-sound | 0 | - | 5 | search_reference×1 read_reference×1 calc×1 write_proof×1 check_tex×2 | $0.039 |
| e4-zeta3-irrational | T3 | E3 | gave_up | tex-valid, proof-sound | 0 | - | 0 | calc×1 search_reference×1 | $0.014 |

## 結末の分類
- gave_up: 21
- stopped_by_review: 2
- verified: 1

## 最後に落ちた基準
- proof-sound: 23
- tex-valid: 11

## 方針の一覧
### e4-pi-squared-irrational generator/T0 #1（gave_up）
- 方針1: π² の無理数性を、Niven型（または Niven の多項式論法）の背理法で示す。まず π が無理数ならば π² も無理数であることを使うのではなく、π² が有理数 a/b と仮定して、整数係数の多項式を用いた補助積分 I_n の評価から矛盾を導く。具体的には、f(x)=x^n(1-x)^n/n! とおき、有理数の仮
- 方針2: π²=6ζ(2)より、ζ(2)の無理数性をBeukersの二重積分法で示す。I_n=∫_0^1∫_0^1 (x y(1-x)(1-y))^n / (1-xy)^(n+1) dx dy を定義し、(1) I_n=A_n ζ(2)+B_n（A_n,B_nは整数）と展開できること、(2) I_nが整数係数の既約分数の形で ζ
- 方針3: 方針2（Beukers型の二重積分）は維持しつつ、前提を見直す。まず π²=6ζ(2) の関係と、ζ(2) の無理数性の証明に必要な整数性の条件を、n=1,2 の具体例で手計算して確認する。その上で、一般 n の評価を Apéry 型の漸化式（三項間漸化式で I_n を与える形）に置き換え、有理近似列の分母と誤差の評価
### e4-pi-squared-irrational generator/T0 #2（gave_up）
- 方針1: π²が無理数であることを、Niven型の背理法（Niven の証明の要点）で示す。π²が有理数 a/b と仮定し、適当な多項式 f(x) を用いて積分 I = ∫_0^π f(x) sin x dx を二通りに評価することで、0 < I < 1 かつ I が整数となる矛盾を導く。手計算で追える範囲に絞り、write_p
- 方針2: Niven型の背理法は維持しつつ、前回つまずいた端点 x=π での整数性を、多項式の係数の分母評価で明示的に示す方針に変える。具体的には π²=a/b（a,b は正の整数）と仮定し、f(x)=x^n(a−bx²)^n/n! とおいて、f^{(j)}(0) と f^{(j)}(π) がともに整数になる根拠を、x の多項式
- 方針3: 方針3：端点 x=π の整数性に頼る現行の構成を捨て、積分の評価を一つ減らした『偶関数の多項式を (x²) の形で扱う』構成に組み替える。まず π²=a/b（a,b は正の整数）と仮定し、整数係数の多項式 g(t) を t=x² で定義して、x=0 での導関数の整数性を確認する。次に、π で評価される項が必ず π² の
### e4-pi-squared-irrational generator/T0 #3（gave_up）
- 方針1: π² が無理数であることを、Niven型の多項式恒等式（Niven の証明の変形：π² が有理数 a/b なら補助関数 f(x)=x^n(a−bx)^n/n! を用いて整数性と微小性の矛盾を導く）を手計算で示す。まず write_proof で証明文を work/proof.md に書き、check_tex で数式の組
### e4-pi-squared-irrational generator/T1 #1（gave_up）
- 方針1: π² の無理数性を、Niven 型（あるいは Miller/Ivan Niven の 1947 年の多項式積分法）の背理法で示す。まず π² が有理数 a/b と仮定し、適切な多項式 f(x) を構成して、積分 ∫_0^π f(x) sin x dx が一方では整数、他方では 0 と 1 の間の非整数になることを示す。
- 方針2: π²=a/b（a,b は自然数）と仮定し、π が代数的数であることを示す。さらに iπ も代数的で非零となり、e^{iπ}=−1 が代数的数になる。これは Hermite–Lindemann の定理（非零の代数的数 α について e^α は超越数）に矛盾する。引用する定理の内容と適用条件を明示し、各飛躍を式で一つずつ示
### e4-pi-squared-irrational generator/T1 #2（gave_up）
- 方針1: Niven型の証明（Niven 1947 / Cartwright の方法）で、π²が無理数であることを背理法で示す。まずπ²=a/bと仮定し、整数係数の多項式 f_n(x)=x^n(a-bx)^n/n! を用いて補助関数 F(x)=Σ(-1)^j (f^{(2j)}(x)+...) を構成し、sinπx の積分との組
### e4-pi-squared-irrational generator/T1 #3（gave_up）
- 方針1: Niven型の初等証明（Niven 1947 の多項式法、またはその簡略版）を採用する。背理法で π² が有理数 a/b と仮定し、整数係数の多項式 f(x) と、区間 [0,π] 上の積分 I_n = ∫_0^π f(x)^n sin x dx を定義して、I_n が整数であり同時に 0 < I_n < 1 となるよ
- 方針2: 現行の多項式 f(x)=x^n(a−bx²)^n/n! は端点 π での f^{(j)}(π) の整数性を示せないため、この方針は捨てる。代わりに、π² の有理性を仮定して、区間 [−1,1] 上の Hermite 型の積分 I_n=∫_{-1}^{1}(1−x²)^n cos(√(2π²)·x)... のような恒等式
- 方針3: 方針3：背理法で π²=a/b（a,b は正の整数）と仮定し、π が代数的数になることを示したうえで、既知の定理（リンデマンの定理：π は超越数）を引用して矛盾を導く。初等的な多項式積分の構成は、端点での対称性と整数性の条件を一般 n で確定するまで保留する。
### e4-pi-squared-irrational generator/T2 #1（verified）
- 方針1: Niven の方法（Niven 1947 型の初等証明）を用いる。整数係数の多項式 f(x)=x^n(a-bx)^n/n! を考え、0 < x < π で積分の交代和 F(x)=Σ(-1)^k f^{(2k)}(x) を定義して、d/dx[F'(x)sin x − F(x)cos x]=f(x)sin x を利用し、∫
### e4-pi-squared-irrational generator/T2 #2（gave_up）
- 方針1: Niven型の証明（Niven 1947 の多項式積分法）を採用する。まず背理法で π² が有理数 a/b と仮定し、整数係数の補助多項式 f(x) を定義して、積分 ∫₀^π f(x) sin x dx が非零の整数になることを示し、その絶対値が 1 未満であることから矛盾を導く。各段階で数式を TeX で明示し、最
- 方針2: 前提を見直し、Niven型の補題（f^(j)(π)の整数性）に固執せず、Beukers型の二重積分表示によるζ(2)の無理数性の証明を新方針とする。まず search_reference で骨子を確認し、必要な補題（積分表示の等式、被積分関数の整数係数展開、評価値の上下界）をそれぞれ独立に自前で証明してから write
- 方針3: Niven型の枠組みは維持し、π²=a/b (a,b は正の整数) と仮定して補助多項式 f(x)=x^n(a−bx²)^n/n! を用いる。ただし f は偶関数なので、整数性は奇数階の導関数を避けて F(x)=Σ_{k} (−1)^k f^{(2k)}(x) の形で扱う。b^n f の係数が整数であることから f^{
### e4-pi-squared-irrational generator/T2 #3（gave_up）
- 方針1: Niven型の証明（Niven 1947 の多項式積分法）を採用する。まず背理法で π² = a/b（a,b 正の整数）と仮定し、整数係数の多項式 f(x) = x^n(a−bx²)^n / n! を定義する。f と各導関数の整数性、および 0<x<π での正値性と有界性から、積分 I = ∫_0^π f(x) sin
- 方針2: 前提を切り替える。背理法で π² = a/b（a, b は正の整数）と仮定すると π = √(a/b) となり、π は有理数係数の多項式 bx² − a の根、すなわち代数的数になる。この事実と Lindemann の定理（π は超越数）との矛盾で証明する。Niven 型の積分構成は捨てる。根拠は π の無理数性ではな
### e4-pi-squared-irrational generator/T3 #1（gave_up）
- 方針1: Niven型の証明（Niven 1947の古典的手法）を採用する。もし π² が有理数 a/b と仮定すると、整数係数の多項式とその積分を組み合わせて、整数であるはずの量が 0 < x < 1 の範囲で正の非整数になることを示し、矛盾を導く。まず write_proof で証明の骨組みを書き、check_tex で数式
### e4-pi-squared-irrational generator/T3 #2（gave_up）
- 方針1: Niven型の証明（Niven 1947 / Hermite-Lindemann 系の古典的多項式法）を用いる。まず背理法で π² が有理数 a/b と仮定し、整係数多項式 f(x)=b^n x^{...} 等の補助関数を構成して、積分を使った恒等式により正の整数値となるが 0<値<1 となる矛盾を導く。その前に、π 
- 方針2: 前提を修正し、π²=6ζ(2) と見なして ζ(2) の無理数性を示す方針に切り替える。具体的には Beukers 型の二重積分法を用いる。定義 I_n = ∫_0^1∫_0^1 (x(1-x)y(1-y))^n/(1-xy)^{n+1} dx dy を置くと、展開により I_n = A_n - B_n ζ(2)（A_
- 方針3: 前提を整理し直す。π²=6ζ(2) なので、ζ(2) の無理性を示せば π² の無理性が従う。ζ(2) 用の二重積分 I_n を、指数 n+1 の選び方と分母 d_n^2 による整数化を自分で導出する自己完結型の Beukers 型証明に切り替える。まず、I_n が A_n − B_n ζ(2)（A_n, B_n は整
### e4-pi-squared-irrational generator/T3 #3（gave_up）
- 方針1: Niven型の証明（Niven 1947 の方法）を採用する。もし π² が有理数 a/b と仮定すると、多項式 f(x)=x^n(a−bx)^n/n! を用いて積分 I_n=∫_0^π f(x)sin x dx を考える。f と有限回の微分で得られる整数性と、0<I_n<ε を組み合わせて矛盾を導く。ここで writ
- 方針2: 前方針の前提を捨て、π²=a/b（a,b は整数、b>0）と仮定した上で、Niven型の多項式を変数 x ではなく π² に対応する a/b を根とする形 f(x)=x^n(a−bx)^n/n! に組み直す。その上で f の導関数が整数値をとることを、対称性 f(x)=f(a/b−x) と、x²の多項式として扱う性質か
### e4-zeta3-irrational generator/T0 #1（stopped_by_review）
- 方針1: Apéry型の議論（Beukers流の二重積分表示）を用いる。まず ζ(3) = −(1/2)∫∫ log(x)log(y)log(1−xy)/... ではなく、Beukers の積分 I = ∫_0^1∫_0^1 −log(x)log(y)/(1−xy) dx dy = 2ζ(3) を手計算で示し、有理近似列 (p_
- 方針2: 前提を一度捨て、Apéry-Beukers 型の議論に一本化する。具体的には、整数係数の Legendre 型多項式 P_n(x)=(1/n!) d^n/dx^n (x^n(1-x)^n) を用い、二重積分 I_n = ∫_0^1∫_0^1 -log(xy) P_n(x) P_n(y) / (1-xy) dx dy を
- 方針3: 前提を見直し、Beukers 型の二重積分による一本化を維持しつつ、作業順序を変える。第一に、I_n = ∫_0^1∫_0^1 −log(xy)·P̃_n(x)P̃_n(y)/(1−xy) dx dy（P̃_n は移動 Legendre 多項式、P̃_n(x)=(1/n!)d^n/dx^n(x^n(x−1)^n)）を定
### e4-zeta3-irrational generator/T0 #2（gave_up）
- 方針1: Apéry流の証明（ζ(3)の近似有理数列と漸化式を用い、分母の増大と誤差の減少を比較して無理数性を導く）を採用し、まず補題として漸化式と整数性を手計算で確認する。
- 方針2: 方針2：Beukersの二重積分表示を核に、整数係数の線形形式 b_nζ(3)−a_n を導出し、その値が十分小さい一方で分母がlcm(1,...,n)^3程度に抑えられることから矛盾を導く。まず積分の恒等式、漸化式の由来、線形形式の整数性、誤差評価の4つを論証の骨格として順に確立する。
- 方針3: Beukers型の二重積分を、ζ(2)が現れない核に置き換えて再構成する。具体的には、R_n(x,y)=(x(1-x)y(1-y))^n/(1-xy)^{n+1} を用いた積分 I_n=∫_0^1∫_0^1 -log(xy)·R_n(x,y) dx dy を立て、(1) I_n=A_n ζ(3)−B_n の形（A_n,
### e4-zeta3-irrational generator/T0 #3（gave_up）
- 方針1: Apéry型の証明に従い、整数係数の漸化式で定義される有理数列 b_n を用いて、ζ(3) の有理近似列を構成する。その上で、b_n ζ(3) − a_n が正の値を取りつつ 0 に収束し、かつ分母が指数的に増える数列の増大より速く小さくなることを示し、ζ(3) が有理数ならば矛盾することを導く。具体的には、積分表示 
### e4-zeta3-irrational generator/T1 #1（gave_up）
- 方針1: Beukers（1979）の積分法を採用する。まず $\int_0^1\int_0^1 \frac{-\log(xy)}{1-xy}\,dx\,dy = 2\zeta(3)$ を示し、次にシフト・ルジャンドル多項式 $\tilde P_n(x)$ を使って $a_n\zeta(3)-b_n$（$a_n,b_n\in\m
### e4-zeta3-irrational generator/T1 #2（gave_up）
- 方針1: Apéry-Beukers法を採用する。ζ(3)の有理近似列 p_n/q_n を、二重積分 ∫∫ x^n(1-x)^n y^n(1-y)^n / (1-xy)^(n+1) dx dy から作る。この積分が整数係数の線形形式 a_n ζ(3) - b_n になることを示し、a_n が指数的に増大する一方で |a_n ζ(
- 方針2: 前提を見直し、二重積分の形を最初から作り直す方針に切り替える。具体的には、Beukers（Apéry の証明の積分版）の積分表示を出発点にする。シフト・ルジャンドル多項式 P_n(x)=(1/n!) d^n/dx^n [x^n(1-x)^n] を用い、I_n=∫_0^1∫_0^1 −log(xy) P_n(x)P_n(
### e4-zeta3-irrational generator/T1 #3（gave_up）
- 方針1: Beukers流の積分法を採用する。二重積分 ∫∫ -log(xy)/(1-xy) dx dy が ζ(3) に等しいことを示し、シフトしたルジャンドル多項式 P_n(x) から有理数の近似列 a_n/b_n を構成する。その上で ζ(3) を有理数で近似する列が「0 ではないが、分母の増大に比べて極めて速く 0 に収
- 方針2: 方針を切り替え、Apéry 型の数列と三項漸化式による無理数性の証明を採用する。具体的には、b_n = Σ_k C(n,k)^2 C(n+k,k)^2 と a_n を三項漸化式で定義し、その漸化式を Zeilberger 型の certificate（伸縮（telescoping）の証明）で厳密に示す。次に、a_n −
- 方針3: 方針3: Beukers型の二重積分を捨て、ヘルミート–パデ近似による線形形式で示す。整数係数の有理関数 R_n(x) を Li_3 型の関数と組み合わせて、整数 a_n, b_n, c_n からなる線形形式 L_n = a_n + b_n ζ(3) を構成する。(1) L_n は整数係数の定義式から分母の整数性を持ち
### e4-zeta3-irrational generator/T2 #1（stopped_by_review）
- 方針1: Apéry の方法を用いる。整数列 a_n, b_n と、それらが満たす漸化式から得られる有理近似列 p_n/q_n を構成し、q_n ζ(3) - p_n が 0 に収束しつつ 0 でないことを示して、ζ(3) が有理数ではないことを背理法で導く。具体的には、Apéry 数の漸化式 (n+1)^3 u_{n+1} =
- 方針2: Beukers（1979）の方法に切り替える。シフト・ルジャンドル多項式 $P_n(x)=\frac{1}{n!}\frac{d^n}{dx^n}(x^n(1-x)^n)$ を用いた重積分 $I_n=\int_0^1\int_0^1 \frac{-\log(xy)}{1-xy}P_n(x)P_n(y)\,dx\,dy$
### e4-zeta3-irrational generator/T2 #2（gave_up）
- 方針1: Apéryの定理の標準的証明（Beukersによる積分表示と、有理数近似の列を用いる背理法）で ζ(3) の無理性を示す。まず有理数近似の列 p_n/q_n を構成して |q_n ζ(3) − p_n| が指数的に小さくなることを示し、その列の分母が指数的に増える（q_n が有理数の極限として矛盾を生む）ことを確かめる
- 方針2: 方針2：前回の曖昧さを解消するため、証明の骨格を「線形形式の定義 → 非零性 → 整数性 → 誤差の指数的減衰 → 分母の増大との比較」の順に明示して組み直す。具体的には、Apéry数 b_n と二重和による整数列 a_n を用いて線形形式 L_n = b_n ζ(3) − a_n を定義し、Beukers の二重積分
- 方針3: 方針3：Apéry型の線形形式を、Beukers二重積分の被積分関数を明示的な Legendre 多項式（Rodrigues 形式）で書き直して構成し直す。まず n=1 で L_1 = b_1ζ(3) − a_1 が積分値と一致することを部分分数展開だけで手計算で確定させ、その後に一般 n の恒等式を Legendre
### e4-zeta3-irrational generator/T2 #3（gave_up）
- 方針1: Apéry の方法を用いる。整数列 a_n, b_n（a_n/b_n → ζ(3)、b_n の分母が急成長する）を構成して漸化式を導き、有理近似 p_n/q_n に対して |q_n ζ(3) − p_n| が 0 に収束する一方で q_n ζ(3) − p_n ≠ 0 を示すことで無理数性を導く。具体的には、Beuke
- 方針2: 前方針の数値確認を捨て、Beukers の二重積分法（シフト・ルジャンドル多項式を使う）に切り替える。各 n について I_n = ∫∫ P_n(x)P_n(y)(−log(xy))/(1−xy) dx dy を定義し、I_n = A_n ζ(3) + B_n（A_n, B_n は整数係数で、分母は適切に払える）と展開
### e4-zeta3-irrational generator/T3 #1（gave_up）
- 方針1: Apéryの定理の標準的証明（Beukersの積分表示と既約分数の分母評価による背理法）を採用し、ζ(3)の有理近似列 p_n/q_n を構成して q_n ζ(3) − p_n が 0 に収束するが 0 でなく、かつ q_n が整数で ζ(3) の有理性を矛盾させる、という流れで証明を組む。最初に search_ref
### e4-zeta3-irrational generator/T3 #2（gave_up）
- 方針1: Apéry の方法に従い、整数列 a_n, b_n を用いて近似分数 p_n/q_n を構成し、ζ(3) との差が q_n^{-1} 程度に小さく、かつ分母 q_n が指数的に増大することを示す。その上で、ζ(3) が有理数だと仮定すると、分子 q_n ζ(3) − p_n が 0 でない整数の列となり、それが 0 に
- 方針2: 前提を見直し、Apéry の方法を Beukers の積分表示で再構成する方針に切り替える。具体的には、ζ(3) を含む三重積分（Beukers 型）を立て、その被積分関数をシフトしたルジャンドル多項式の導関数で表して、(1) 積分値が整数係数の線形形 a_n ζ(3) − b_n に一致すること、(2) a_n, b
- 方針3: 前提を組み直し、Apéry 数の漸化式を外部資料から借りる方針を捨てる。出発点を Beukers の二重積分 ∫_0^1∫_0^1 −log(xy)/(1−xy) dx dy = 2ζ(3) とし、シフトしたルジャンドル多項式 P̃_n(x) = (1/n!) d^n/dx^n (x^n(1−x)^n) を使って、被積
### e4-zeta3-irrational generator/T3 #3（gave_up）
- 方針1: Apéry の方法に従い、整数列 a_n, b_n と有理近似列を構成して、ζ(3) が無理数であることを示す（Apéry の定理）。具体的には、ζ(3) の有理近似 p_n/q_n と誤差 |q_n ζ(3) − p_n| が指数的に小さくなる一方、q_n が指数的に増大しない（q_n が整数の公分母として抑えられる

## 追求あたりの方針の数
| 課題 × 構成 | 平均 | 内訳 |
| --- | --- | --- |
| e4-pi-squared-irrational generator/T0 | 2.3 | 3 3 1 |
| e4-pi-squared-irrational generator/T1 | 2.0 | 2 1 3 |
| e4-pi-squared-irrational generator/T2 | 2.0 | 1 3 2 |
| e4-pi-squared-irrational generator/T3 | 2.0 | 1 3 2 |
| e4-zeta3-irrational generator/T0 | 2.3 | 3 3 1 |
| e4-zeta3-irrational generator/T1 | 2.0 | 1 2 3 |
| e4-zeta3-irrational generator/T2 | 2.3 | 2 3 2 |
| e4-zeta3-irrational generator/T3 | 1.7 | 1 3 1 |

## 深さと部分点
| 課題 | 条件 | 構成 | n | 照合を通過 | 95% 区間 | 部分点 | 証明を書いた回数 | 方針の数 | 方針1 での試行 | 断念 / 停止 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| e4-pi-squared-irrational | E3 | generator/T0 | 3 | 0 | 0–56% | 0.13 | 1.67 | 2.33 | 0.67 | 3 / 0 |
| e4-pi-squared-irrational | E3 | generator/T1 | 3 | 0 | 0–56% | 0.20 | 1.33 | 2.00 | 1.33 | 3 / 0 |
| e4-pi-squared-irrational | E3 | generator/T2 | 3 | 1 | 6–79% | 0.40 | 0.67 | 2.00 | 1.67 | 2 / 0 |
| e4-pi-squared-irrational | E3 | generator/T3 | 3 | 0 | 0–56% | 0.00 | 0.33 | 2.00 | 1.67 | 3 / 0 |
| e4-zeta3-irrational | E3 | generator/T0 | 3 | 0 | 0–56% | 0.00 | 2.33 | 2.33 | 1.33 | 2 / 1 |
| e4-zeta3-irrational | E3 | generator/T1 | 3 | 0 | 0–56% | 0.00 | 0.00 | 2.00 | 2.33 | 3 / 0 |
| e4-zeta3-irrational | E3 | generator/T2 | 3 | 0 | 0–56% | 0.00 | 0.00 | 2.33 | 2.67 | 2 / 1 |
| e4-zeta3-irrational | E3 | generator/T3 | 3 | 0 | 0–56% | 0.20 | 0.67 | 1.67 | 2.67 | 3 / 0 |
