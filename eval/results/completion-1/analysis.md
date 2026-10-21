# 失敗の傾向: completion-1

| 課題 | 段階 | 条件 | 結末 | 最後に落ちた基準 | 申告の不合格 | 拒否 | 一段上へ | 道具 | 費用 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a-contradictory-room | T0 | E3 | stopped_by_review | room-id | 0 | strategy_not_exhausted×1 | 1 | search_rooms×2 get_room_schedule×2 read_facility_rules×1 | $0.011 |
| a-contradictory-room | T0 | E3 | stopped_by_review | room-id | 0 | strategy_not_exhausted×3 | 3 | search_rooms×5 get_room_schedule×2 read_facility_rules×2 | $0.025 |
| a-missing-budget | T0 | E3 | stopped_by_review | budget-value, budget-source | 0 | - | 1 | list_budgets×2 read_travel_rules×1 | $0.007 |
| a-missing-budget | T0 | E3 | stopped_by_review | budget-value, budget-source | 0 | strategy_not_exhausted×1 judge_necessary×1 | 3 | list_budgets×3 read_travel_rules×2 get_budget×1(err1) | $0.020 |
| a-stale-supplier-price | T0 | E3 | stopped_by_review | unit-price, contract-ref | 0 | - | 1 | list_suppliers×2 list_contracts×1 | $0.006 |
| a-stale-supplier-price | T0 | E3 | stopped_by_review | unit-price, contract-ref | 0 | - | 1 | list_suppliers×3 list_contracts×1 | $0.007 |
| e4-pi-squared-irrational | T0 | E3 | gave_up | proof-sound | 0 | judge_necessary×2 invalid_proposal×1 | 9 | write_proof×9 check_tex×2 review_draft×1 read_proof×1 | $0.133 |
| e4-pi-squared-irrational | T0 | E3 | stopped_by_review | proof-sound | 0 | strategy_not_exhausted×1 judge_necessary×1 | 10 | write_proof×17 review_draft×7 read_proof×1 check_tex×2 | $0.151 |
| e4-pi-squared-irrational | T0 | E3 | gave_up | proof-sound | 0 | invalid_proposal×2 | 9 | read_proof×1(err1) write_proof×12 check_tex×4 review_draft×4 | $0.154 |
| e4-pi-squared-irrational | T0 | E3 | forced_stop | - | 0 | judge_necessary×3 invalid_proposal×6 | 7 | write_proof×16 review_draft×15 check_tex×6 read_proof×2 | $0.180 |
| e4-pi-squared-irrational | T0 | E3 | stopped_by_review | proof-sound | 0 | - | 10 | write_proof×8 check_tex×5 read_proof×1 review_draft×5 | $0.126 |
| e4-pi-squared-irrational | T0 | E3 | gave_up | proof-sound | 0 | invalid_proposal×1 judge_necessary×2 | 9 | write_proof×14 review_draft×3 check_tex×6 | $0.154 |
| e4-pi-squared-irrational | T0 | E3 | verified | - | 0 | judge_necessary×4 invalid_proposal×1 | 4 | write_proof×2 read_proof×2 check_tex×2 review_draft×1 | $0.064 |
| e4-pi-squared-irrational | T0 | E3 | budget_attempts | - | 0 | judge_necessary×5 | 9 | write_proof×15 check_tex×10 review_draft×12(err1) read_proof×3 | $0.218 |
| e4-pi-squared-irrational | T0 | E3 | verified | - | 0 | judge_necessary×4 invalid_proposal×2 | 7 | write_proof×10 check_tex×6 review_draft×5 read_proof×1 | $0.132 |
| e4-pi-squared-irrational | T0 | E3 | verified | - | 0 | judge_necessary×2 | 4 | write_proof×6 review_draft×3 read_proof×4 check_tex×3 | $0.094 |
| e4-pi-squared-irrational | T0 | E3 | verified | - | 0 | invalid_proposal×2 | 0 | read_proof×2(err1) write_proof×2 check_tex×1 | $0.028 |
| e4-pi-squared-irrational | T0 | E3 | verified | - | 0 | reread_required×2 | 3 | write_proof×3 read_proof×3 check_tex×1 | $0.057 |
| e4-pi-squared-irrational | T0 | E3 | verified | - | 0 | reread_required×2 invalid_proposal×1 judge_necessary×2 | 5 | write_proof×6 read_proof×4 check_tex×1 | $0.107 |
| e4-pi-squared-irrational | T0 | E3 | verified | - | 0 | invalid_proposal×2 | 6 | write_proof×6 check_tex×6 read_proof×5 | $0.102 |
| e4-pi-squared-irrational | T0 | E3 | gave_up | proof-sound | 0 | invalid_proposal×2 reread_required×2 strategy_not_exhausted×5 | 6 | write_proof×4 check_tex×2 read_proof×5 | $0.116 |
| e4-pi-squared-irrational | T0 | E3 | verified | - | 0 | reread_required×1 judge_necessary×1 | 1 | write_proof×3 check_tex×2 read_proof×3 | $0.045 |
| e4-pi-squared-irrational | T0 | E3 | stopped_by_review | proof-sound | 1 | reread_required×6 claim_not_verified×1 invalid_proposal×2 | 10 | write_proof×21 read_proof×7 check_tex×6 | $0.247 |
| e4-pi-squared-irrational | T0 | E3 | gave_up | proof-sound | 0 | reread_required×2 invalid_proposal×3 strategy_not_exhausted×6 | 8 | write_proof×5 check_tex×1 read_proof×6 | $0.129 |
| e4-pi-squared-irrational | T0 | E3 | verified | - | 0 | invalid_proposal×1 reread_required×1 | 1 | read_proof×2(err1) write_proof×1 check_tex×1 | $0.030 |
| e4-pi-squared-irrational | T0 | E3 | gave_up | proof-sound | 0 | reread_required×1 invalid_proposal×1 strategy_not_exhausted×3 | 6 | write_proof×2 read_proof×3 check_tex×1 | $0.090 |
| e4-pi-squared-irrational | T0 | E3 | verified | - | 0 | strategy_not_exhausted×1 judge_necessary×1 | 1 | read_proof×2(err1) write_proof×3 check_tex×2 | $0.055 |
| e4-pi-squared-irrational | T0 | E3 | forced_stop | proof-sound | 0 | invalid_proposal×3 | 6 | write_proof×2 check_tex×2 read_proof×1 | $0.054 |
| e4-pi-squared-irrational | T0 | E3 | gave_up | - | 1 | judge_necessary×1 invalid_proposal×1 claim_not_verified×1 | 9 | write_proof×12 check_tex×3 read_proof×1 | $0.156 |
| e4-pi-squared-irrational | T0 | E3 | verified | - | 0 | invalid_proposal×3 judge_necessary×2 | 5 | write_proof×9 check_tex×8 | $0.134 |
| e4-pi-squared-irrational | T0 | E3 | verified | - | 0 | same_failure×1 judge_necessary×4 | 8 | read_proof×1(err1) write_proof×12 check_tex×5 | $0.186 |
| e4-pi-squared-irrational | T0 | E3 | forced_stop | proof-sound | 0 | - | 1 | write_proof×3 check_tex×2 read_proof×1 | $0.033 |
| e4-pi-squared-irrational | T0 | E3 | forced_stop | - | 0 | judge_necessary×1 | 6 | write_proof×2 check_tex×1 | $0.055 |
| e4-pi-squared-irrational | T0 | E3 | gave_up | proof-sound | 0 | invalid_proposal×4 | 9 | write_proof×6 check_tex×4 read_proof×3 | $0.115 |
| e4-pi-squared-irrational | T0 | E3 | stopped_by_review | proof-sound | 0 | judge_necessary×3 invalid_proposal×1 | 10 | write_proof×13 check_tex×6 | $0.154 |
| e4-pi-squared-irrational | T0 | E3 | stopped_by_review | proof-sound | 1 | invalid_proposal×6 judge_necessary×1 claim_not_verified×1 | 10 | write_proof×10 check_tex×5 read_proof×3 | $0.162 |
| e4-zeta3-irrational | T0 | E3 | stopped_by_review | proof-sound | 0 | judge_necessary×1 strategy_not_exhausted×1 | 6 | write_proof×6 check_tex×3 review_draft×2 | $0.075 |
| e4-zeta3-irrational | T0 | E3 | stopped_by_review | proof-sound | 0 | judge_necessary×1 invalid_proposal×3 | 10 | write_proof×13 check_tex×3 review_draft×4 | $0.166 |
| e4-zeta3-irrational | T0 | E3 | stopped_by_review | proof-sound | 0 | reread_required×2 strategy_not_exhausted×2 | 9 | write_proof×5 read_proof×5 check_tex×4 | $0.117 |
| e4-zeta3-irrational | T0 | E3 | gave_up | proof-sound | 0 | reread_required×5 invalid_proposal×2 strategy_not_exhausted×1 | 8 | read_proof×10(err1) write_proof×14 check_tex×5 | $0.161 |
| e4-zeta3-irrational | T0 | E3 | stopped_by_review | proof-sound | 0 | strategy_not_exhausted×1 | 7 | write_proof×10 check_tex×3 read_proof×1 | $0.077 |
| e4-zeta3-irrational | T0 | E3 | gave_up | proof-sound | 0 | invalid_proposal×2 judge_necessary×2 | 9 | write_proof×8 check_tex×3 read_proof×1 | $0.127 |

## 結末の分類
- stopped_by_review: 15
- verified: 12
- gave_up: 10
- forced_stop: 4
- budget_attempts: 1

## 最後に落ちた基準
- proof-sound: 20
- room-id: 2
- budget-value: 2
- budget-source: 2
- unit-price: 2
- contract-ref: 2

## 方針の一覧
### a-contradictory-room generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #1（stopped_by_review）
- 方針1: まず search_rooms で3階・収容20名以上・projector の候補を絞り込み、次に候補ごとに get_room_schedule で 2026-11-12 の予約・保守を確認して空いている1室を選び、submit_answer で提出する。施設ルールも事前に read_facility_rules で確
### a-contradictory-room generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #2（stopped_by_review）
- 方針1: search_rooms で3階かつ収容20名以上かつprojector対応の候補を絞り込み、各候補について get_room_schedule で2026-11-12の予約と保守を確認し、14:00〜15:00に空きのある部屋を1室選んで submit_answer で提出する。提出前に read_facility_
- 方針2: search_rooms のフィルタ結果を前提にせず、利用可能な検索で全会議室を列挙し、3階の各部屋の設備・収容人数の登録内容を直接確認したうえで、受入条件を満たす部屋が本当に無いのかを検証する。
### a-missing-budget generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #1（stopped_by_review）
- 方針1: list_budgets で営業部・2026H2 の予算レコードを絞り込み一覧し、status が承認済みのものだけを残す。候補が複数や曖昧な場合は get_budget で個別確認し、read_travel_rules の budget 項目で承認済み判定の基準を確かめてから、金額と id を submit_answ
### a-missing-budget generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #2（stopped_by_review）
- 方針1: list_budgets で営業部・2026H2 の予算レコードを絞り込み、承認状態（status）が承認済みのものだけを特定して金額と id を取得し、submit_answer で提出する。経理元帳は permitted:false のため使わない。
- 方針2: 前提を見直し、read_travel_rules の budget 項目で期間・部署の表記規則と承認の定義を確認してから、全件一覧の表記ゆれを照合する。該当する承認済みの2026H2営業部レコードが確認できなければ、2026H1の値で代用せず提出を保留して停止する。
### a-stale-supplier-price generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #1（stopped_by_review）
- 方針1: 取引先一覧で東和オフィスの id を特定し、その契約一覧から 2026 年度(2026-04-01〜2027-03-31)を含む active な契約を絞り込み、get_contract で A4 コピー用紙 500 枚の単価を確認してから submit_answer で提出する。
### a-stale-supplier-price generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #2（stopped_by_review）
- 方針1: 取引先一覧で「東和オフィス」の supplier_id を特定し、その契約一覧から 2026-04-01〜2027-03-31 を含む active の契約を選び、get_contract で A4 コピー用紙 500 枚の単価を読み取ってから submit_answer で提出する。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable #1（stopped_by_review）
- 方針1: Niven型の積分法を用い、π²=a/b (a,b は正の整数) と仮定して矛盾を導く背理法で証明する。
- 方針2: π²=6ζ(2) であることを利用し、Beukers の二重積分法（シフト・ルジャンドル多項式による Apéry 型の議論）で ζ(2) の無理数性を示す。π² = a/b と仮定し、整数係数の有理近似列を作って矛盾を導く背理法とする。Niven 型の三角関数の核は採らない。
- 方針3: π²=6ζ(2) を利用し、Beukers型の二重積分と整数係数の多項式近似によって ζ(2) の無理数性を示す。π²=a/b と仮定し、整数係数の一般n評価で矛盾を導く背理法に一本化する。部品は一括で定義し、仮説ごとの部分検証に戻らない。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable #10（verified）
- 方針1: Niven型の積分恒等式による反証法を用いる。π²=a/b（a,b は正整数）と仮定し、多項式 f_n(x)=b^n x^n (a−bx²)^n / n! を使って、∫_0^π f_n(x) sin x dx が一方では 0 と 1 の間の正の値、他方では整数になることを示して矛盾を導く。
- 方針2: 反証法で π²=a/b（a,b は正整数）と仮定し、有理係数の補助多項式 f を、0 と π の両点で導関数がすべて整数になるように設計し直す。そのうえで Niven 型の積分恒等式 ∫_0^π f(x) sin x dx = F(0)+F(π)（F=Σ(−1)^j f^{(2j)}）を使い、左辺が 0 と 1 の間の
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable #2（gave_up）
- 方針1: 仮定 π²=a/b（a,b は正の整数）から出発し、Niven 型の補助多項式と積分恒等式を用いて、整数性と積分の小ささを矛盾させる背理法で示す。
- 方針2: 仮定 π²=a/b（a,b は正の整数）から出発する背理法を維持しつつ、補助関数を x² の多項式として組み、0 と π の両端での導関数がすべて整数の b^n 倍に収まることを先に確認してから、積分恒等式と上界評価を同じ n で両立させる。
- 方針3: 前回までの補助関数 x^{2n}(a−bx²)^n/n! の整数性・積分恒等式の組み合わせは一般の n で閉じなかったため破棄する。新方針として、仮定 π²=a/b のもとで f_n(x)=x^n(1−x)^n/n! を [0,1] 上で sin(πx) と組み合わせる積分 J_n を定義し、J_n が正で、b の冪に
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable #3（forced_stop）
- 方針1: Niven型の多項式積分法で背理法により証明する。π²=a/b（a,b正整数）と仮定し、整数係数の多項式 f(x)=x^n(a−bx²)^n/n! をスケールして、その導関数の0およびπでの値が整数になることを示す。さらに F(x)=Σ(−1)^j f^(2j)(x) を用いた積分恒等式 ∫_0^π f(x)sin x
- 方針2: 前提を見直し、Niven型の積分法を維持したまま、0<I<1 の評価を最初に独立に確定させる『評価先行型』に組み直す。各補題は1つずつ検証し、依存関係が閉じてから全体を結ぶ。
- 方針3: 既存の Niven 型の構成は捨てず、n を偶数に固定して f が偶関数になるよう組み直す。偶数次導関数だけを使い、b の冪で全体を払って整数性を示す。0<I<1 の評価は n を最後に選ぶ順序で行い、各部品を独立に確認できる形にする。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable #4（gave_up）
- 方針1: π²=a/b と仮定し、整数係数の多項式 f_n(x)=x^n(a−bx)^n/n! を用いる Niven 型の積分論法で矛盾を導く。
- 方針2: π²=a/b（a,b は正の整数）と仮定し、b^n·x^n(a−bx²)^n/n! を用いる Niven 型の sin 積分論法で矛盾を導く。前の方針と違い、係数の倍率を b^n に一本化し、積分の上界 b^n a^n π^n/n! を明示して 0 への収束を先に確認する。
- 方針3: Niven型の積分論法を、補助関数を F(x)=b^n x^n(a−bx²)^n/n! に固定し直して組み立て直す。仮定 π²=a/b（a,b は正の整数）から始め、(1) F の整数係数性、(2) x=0 と x=π での F^{(k)} の整数性、(3) 部分積分による ∫_0^π F(x) sin x dx の整
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable #5（budget_attempts）
- 方針1: π²=a/b と仮定し、整数係数の多項式 f(x)=b^n x^n(a−bx²)^n/n! を用いる Niven 型の積分論法で矛盾を導く（Lindemann や π の超越性は引用しない）。
- 方針2: 前提を見直し、f の定義を一つに固定してから、整数性・恒等式・評価の三つを別々の部品として先頭から順に手計算で示す。これまでの仮説は f の定義が b^n と b^{2n} で食い違い、整数性の根拠も未検証のまま残っていたため、その点を解消する。戦略自体は Niven 型の積分論法を維持し、π²=a/b から矛盾を導く
- 方針3: 方針3: n を偶数に固定して補助多項式の次数パリティを揃え、偶数次の導関数だけを使う Niven 型の積分論法で π²=a/b から矛盾を導く。方針1・2で詰まった奇数次の扱いを、n の偶奇の選び方で解消する。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable #6（stopped_by_review）
- 方針1: Niven型の積分論法で示す。π²=a/b と仮定し、整数係数の多項式 f_n(x)=b^n x^n(π²−x)^n/n! と、その交代和 F(x)=Σ(-1)^j f_n^{(2j)}(x) を用いて、適当な三角関数との積分が整数値であることと、その値が0と1の間にあって整数にならないことを示す。
- 方針2: 仮定 π²=a/b（a,b は正の整数）のもとで、整数係数の多項式 h(x)=x^n(a−bx)^n/n! を取り、重みとして φ(x)=sin√x/√x（べき級数が有理数係数で、x=0 で正則）を使う。部分積分の交代和で ∫_0^{π²} h(x)φ(x)dx を端点値の整数和に書き換え、その値が 0 と 1 の間に
- 方針3: 既存のNiven型(sin重み・端点π)を捨て、Beukers型のLegendre多項式による積分論法でζ(2)=π²/6の無理数性を示し、π²=6ζ(2)から結論を得る。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable #7（gave_up）
- 方針1: π²=6ζ(2)より、ζ(2)の無理数性をBeukersの二重積分法で示す。n次の二重積分I_nが整数係数の線形形p_n+q_nζ(2)で書け、0<I_n→0が速いことから、ζ(2)=a/bと仮定すると矛盾が生じる。
- 方針2: Beukers型のI_nの整数係数分解に頼らず、Niven型の多項式積分法で「整数になるはずの量が0より大きく1より小さい」ことを示す背理法に切り替える。仮定 π²=a/b（a,b は正整数）から、整数係数の多項式 f_n(x)=b^n x^n(a−bx)^n/n! を作り、その導関数の整数性と補助関数 F_n(x)=
- 方針3: 方針3：Beukers型の二重積分 I_n を維持しつつ、整数化を lcm による分母の掃き出しで明示的に行う。前回失敗した「整数係数の p_n+q_nζ(2) への分解」を、d_n=lcm(1,...,n) を掛けて整数性を担保する形に組み替え、ζ(2)=a/b の仮定から 0<|整数|<1 の矛盾を導く。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable #8（verified）
- 方針1: 背理法で π²=a/b（a,b は正の整数）と仮定し、Niven 型の積分論証で矛盾を導く。多項式 f(x)=b^n x^n(a−bx²)^n/(2n)! を定め、部分積分の反復で整数性と小ささを同時に示す方針を取る。
- 方針2: π²=a/b（a,b は正の整数）と仮定し、補助多項式の π 側の値を整数の和として直接扱う。ただし前回の方針で詰まった f^{(k)}(π) の整数性は使わず、sin x を重みとする積分 J_n=∫_0^π p(x) sin x dx を部分積分で評価し、J_n が整数として表される形を作ってから、0<J_n<1 
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable #9（verified）
- 方針1: Niven型の積分法で背理法により示す。π²=a/b（a,b正の整数）と仮定し、対称性をもつ整数係数多項式 f(x)=x^n(a−bx)^n/n! から補助関数 F を作り、sin√x を含む積分恒等式で 0<I<1 の矛盾を導く。
- 方針2: π²=a/b（a,b は正の整数）と仮定し、x² の多項式 f(x)=x^n(a−bx²)^n/n! を補助関数に使う Niven 型の背理法で示す。sin x に対する積分 I=∫_0^π f(x) sin x dx を部分積分で整数の和に直し、0<I<1 と矛盾させる。
- 方針3: 方針3: 方針2の骨格（π²=a/b の仮定、x²の多項式 f、Σ(−1)^j f^{(2j)} による補助関数 F、I=∫_0^π f(x) sin x dx の整数性と上界）は残し、f を b^n 倍して端点値の整数性を先に確立してから積分恒等式を立てる。前回の行き止まりは、f^{(k)}(π) の整数性と I の
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #1（stopped_by_review）
- 方針1: Niven型の積分論法で背理法を用いる。π²=a/b（a,b は正整数）と仮定し、x=0 と x=π で導関数がすべて整数値をとる補助多項式 f_n を構成する。その多項式を用いて ∫_0^π f_n(x) sin x dx が正の整数になることを示し、一方でその値が n→∞ で 1 未満になることを示して矛盾を導く。
- 方針2: 方針を変更する。Niven型の補助多項式（π を係数に含む x=π での導関数の整数性）は行き止まりなので捨て、π²=6ζ(2) の有理性をBeukers型の二重積分による有理近似列で扱う。仮定 π²=a/b から ζ(2)=a/(6b) の有理性を得て、分母が指数的に払える有理近似の誤差評価で矛盾を導く。
- 方針3: Niven型の補助多項式を捨て、π²=6ζ(2)と見て、ζ(2)の無理数性をBeukers型の二重積分による有理近似列で示す。先にBasel恒等式ζ(2)=π²/6を初等的に確立し、π²=a/bの仮定から分母が指数的に払える誤差評価で矛盾を導く。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #10（verified）
- 方針1: 背理法で、π²=a/b（a,b は正の整数）と仮定し、Niven 型の積分論法で矛盾を導く。整数係数の多項式 f と F=Σ(-1)^k f^{(2k)} を作り、∫_0^π f(x)sin x dx が F(0)+F(π) に等しいことを使う。F(0), F(π) は整数になるため、積分は整数値をとる。一方で積分は 
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #2（verified）
- 方針1: 背理法で π²=a/b（a,b は正の整数）と仮定し、Niven 型の多項式 f(x)=x^n(a−bx²)^n/n! と補助関数 F(x)=Σ(−1)^j f^{(2j)}(x) を用いて、整数であり 0 と 1 の間にあるはずの積分値を作り、矛盾を導く。
- 方針2: 背理法で π²=a/b（a,b は正の整数）と仮定し、偶関数 g(x)=b^n x^n(a−bx²)^n/n! を補助関数に用いる。g は偶関数なので、偶数階導関数 g^{(2j)}(π) は π の偶数乗のみから成り、π²=a/b により有理数に落ちる。これで F(x)=Σ(−1)^j g^{(2j)}(x) の F
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #3（verified）
- 方針1: Niven型の補助多項式と積分恒等式を用い、π²=a/b（a,b は正の整数）と仮定して矛盾を導く背理法で示す。
- 方針2: π²=a/b（a,b は正の整数）と仮定し、補助多項式 f(x)=x^n(a−bx)^n/n! の導関数の整数性（0 と a/b=π² の両側）を土台にして、三角関数の核ではなく指数関数を核とする積分恒等式を立てる。その境界項が整数の組合せで閉じることを示し、評価との矛盾から背理法で結論する。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #4（verified）
- 方針1: Niven型の積分法を用いる。π²=a/b と仮定し、有理係数の多項式 f(x)=x^n(a−bx²)^n/n! に cos x を掛けて区間 [0,π] で積分し、その値が整数であることと、n を大きくすると 0 と 1 の間に入ることの両方から矛盾を導く。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #5（gave_up）
- 方針1: 背理法で進める。π²=a/b（a,b は正の整数）と仮定し、Niven 型の多項式積分法を用いて、ある整数量が 0 と 1 の間に入るという矛盾を導く。多項式は x^n(a−bx)^n/n! の形を基本にし、対称性 f(x)=f(a/b−x) を利用する。
- 方針2: 方針を変え、π²=a/b（a,b は正の整数）の仮定から出発する Niven 型の積分法を、次数 3n の多項式 f(x)=x^n(a−bx²)^n/n! に対して、整数性の倍率（b の冪）と上界の評価を最初から明示的に固定して組み直す。
- 方針3: 方針3：x²を変数tに置き換えた多項式として扱う。f(x)=h(x²)、h(t)=t^n(a−bt)^n/n! とおき、f^{(j)}(0) と f^{(j)}(π) の整数性（b の冪倍）を、奇数冪を含む x の微分ではなく t=a/b まわりの h^{(i)}(a/b) の経由で示す。その上で部分積分による恒等式 
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #6（verified）
- 方針1: Niven型の積分法で背理法を使う。π²=a/b と仮定し、整数係数の多項式 f(x)=x^n(a−bx²)^n/n! を作り、交代和 F を用いて ∫_0^π f(x) sin x dx が整数になることを示す。一方で、n を大きくとるとその積分は 0 より大きく 1 より小さくなるので矛盾が生じる。
- 方針2: 方針2：π²=a/b（a,b は正の整数）と仮定し、x=π で a−bx² が消えることを使う。ただし f(x)=x^n(a−bx²)^n/n! の x^n 因子は捨て、x の偶数冪だけからなる補助多項式 f_n を構成し直す。そのうえで I_n=∫_0^π f_n(x) sin x dx が整数であることと 0<I_
- 方針3: 方針3：前方針の失敗原因は n の偶奇の扱いにあると整理し直す。π²=a/b（a,b は正の整数）と仮定し、n を正の偶数に限定して f(x)=x^n(a−bx²)^n/n! を作る。f は偶関数になるので、交代和 F(x)=Σ_j (−1)^j f^{(2j)}(x) に現れるのは偶数階導関数だけで、その値は π²=
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #7（gave_up）
- 方針1: Niven型の積分論法で背理法を行う。π²=a/b（a,b は正整数）と仮定し、整数係数の補助多項式 f(x)=b^n x^n(a−bx)^n/n! を作って、その偶数階導関数の和 F と三角関数の積分から、整数であるはずの量が0と1の間に入ることを示して矛盾を導く。
- 方針2: π²=6ζ(2) に着目し、ζ(2) の無理数性を Beukers 型の二重積分法で示す。ζ(2)=p/q と仮定し、整数の二重積分の恒等式と小ささの評価を組み合わせて矛盾を導く。Niven 型の sin 積分は捨てる。
- 方針3: Niven型の積分論法を、まず端点π側の整数性の検査から始め直す。π²=a/bと仮定し、補助多項式f(x)=x^n(a−bx²)^n/n!について、f^{(j)}(0)が整数であることに加え、f^{(j)}(π)も整数になるかを手計算で確認する。この検査が通らなければ、方針を続けず、成立しない主張を明記して報告する。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #8（gave_up）
- 方針1: Niven型の背理法で示す。π²=a/b（a,b 正の整数）と仮定し、整数係数の補助多項式族と三角関数の積分恒等式を組み合わせて、整数であるべき量が 0 と 1 の間の正の値になるという矛盾を導く。
- 方針2: Niven型の補助関数族は残すが、分母処理の順序を変える。先に f の係数を b^n 倍した整数係数の補助多項式として定義し、F(0) と F(π) の整数性を先に確定させてから積分恒等式と上界評価を組み合わせる。
- 方針3: Niven型の補助関数族を捨て、π²=a/b（a,b正整数）と仮定したうえで、Hermite型の指数近似ではなく、π²が有理数なら√-1·π=iπ を代数的に扱う別経路を検討する。具体的には、整数係数多項式の根としての πi（または π）の代数性・整数性に訴える補助多項式を一から設計し、各補題を自己完結させて矛盾を導く
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #9（verified）
- 方針1: π²=a/b（a,b は正の整数）と仮定し、Niven 型の積分法で矛盾を導く。整数係数の補助多項式 f_n を用い、積分 I_n が整数になることと、I_n が n→∞ で 0 に近づくことを示して矛盾させる。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable #1（verified）
- 方針1: 背理法で π²=a/b（a,b は正の整数）と仮定し、Niven 型の積分恒等式を用いて矛盾を導く。多項式 f_n(x)=x^n(a−bx)^n/n! の導関数の整数性と、sin 関数との積分の評価を組み合わせる。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable #10（stopped_by_review）
- 方針1: 仮定 π²=a/b（a,b は正の整数）から矛盾を導く Niven 型の積分論証を用いる。多項式 f(x)=x^n(π²−x²)^n/n! を用い、b^n 倍して整数係数にそろえた上で、補助関数 F(x) の交代和が F(0), F(π) で整数値をとることと、積分 ∫_0^π f(x) sin x dx が正で十分小
- 方針2: 方針2：Niven型（f(x)=x^n(a−bx²)^n/n! と交代和）を捨て、ζ(2)=π²/6 の二重積分表示と、シフト付きルジャンドル多項式による Beukers 型の近似列で無理性を示す。
- 方針3: 方針3：Niven型の交代和と分母 n! の処理を捨て、ζ(2)=π²/6 の無理性を Apéry 型の整数列と有理近似で示す。Euler の関係式で π² を ζ(2) に結びつけ、有理数倍の不変性で π² の無理性に帰着させる。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable #2（verified）
- 方針1: 背理法で、π²=a/b（a,b は正の整数）と仮定し、Niven 型の補助多項式と三角関数の積分を組み合わせて、整数であるべき量が 0 と 1 の間の非整数になることを示す。
- 方針2: Niven型の背理法を、補助関数の整数性と積分の大きさの両立を検査しながら組み直す。仮定 π²=a/b（a,b 正の整数）の下で f(x)=x^n(a−bx²)^n/n! を用い、b^n を掛ける整数化をやめて f 自体の係数が (1/n!)·整数 であることを使う。
- 方針3: 方針3: Niven型の積分恒等式を維持しつつ、整数化の乗数を n!·b^n から切り離して、F(0) の整数性は k≥n の k!/n! 項で示し、F(π) の整数化は π^2=a/b による分母 b の冪のみで処理する。その上で、積分の上界を n→∞ で 1 未満に抑え、整数が (0,1) に入る矛盾を導く。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable #3（gave_up）
- 方針1: 背理法で π²=a/b（a,b は正の整数）と仮定し、Niven型の積分法で矛盾を導く。多項式 f(x)=b^n x^n(a−bx)^n/n! と F(x)=Σ(−1)^i f^{(2i)}(x) を作り、積分 ∫_0^π f(x) sin x dx が整数値でありながら 0 と 1 の間に入ることを示す。
- 方針2: 方針2: 背理法で π²=a/b を仮定し、根が ±π に来る整数係数多項式 f(x)=b^n x^{2n}... ではなく、x²=π² の対称性を持つ f(x)=b^n x^n(a−bx²)^n/n! を作る。まず部分積分で恒等式を閉じられる積分（sin 型ではなく x↔π−x 対称性を満たす核）を手計算で探し、その
- 方針3: 方針3: 背理法で π²=a/b（a,b は正の整数）を仮定し、x=0 と x=π の両端で導関数が整数になる偶対称の多項式 f(x)=b^n x^n(a−bx²)^n/n! を用いる。部分積分で積分 I_n=∫_0^π f(x) sin x dx を整数値の和に書き直し、n を大きくして 0<I_n<1 を示すことで
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable #4（verified）
- 方針1: Niven型の積分法で背理法を用いる。π²=a/b と仮定し、a−bx² が x=π で零になる多項式 f_n(x)=x^n(a−bx²)^n/n! を用いて、I_n=∫_0^π f_n(x) sin x dx が一方で非零整数、他方で n→∞ に 0 へ収束することを示して矛盾を導く。
- 方針2: 偶数 n に限定した Niven 型の積分法を、π²=a/b の仮定のもとで作り直す。被積分関数の偶数次性を使い、π の奇数乗が現れない導関数の有理性と分母の評価を先に確定してから、積分値の正値性と上界の比較で矛盾を導く。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable #5（forced_stop）
- 方針1: Niven型の積分論法で背理法により示す。π²=a/b（a,b は正の整数）と仮定し、整数係数の補助多項式を作って、その積分が一方では整数、他方では0と1の間にあることを導く。
- 方針2: 方針2: 補助関数の整数性を先に確かめてから積分論法を組む。π²=a/b（a,b は正の整数）と仮定し、x=π での値と導関数が整数になる根拠を、奇数べきの π が残らない形で先に確定させる。確定しない限り、積分の矛盾（0と1の間の整数）には進まない。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable #6（forced_stop）
- 方針1: Niven型の積分論法で、背理法により π² = a/b（a, b は正の整数）と仮定して矛盾を導く。
- 方針2: π²=a/b（a,bは正の整数）の仮定から出発し、既存のNiven型の対称性に頼らず、x=π の零点の位数と f^{(k)}(π) の整数性を直接結ぶ補助関数を一つ定めて矛盾を導く。前方針の f(π−x)=f(x) は使わない。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable #7（forced_stop）
- 方針1: Niven型の積分論法を π² に適用し、π²=a/b と仮定して矛盾を導く背理法で示す。
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable #8（stopped_by_review）
- 方針1: Niven型の積分法を用いる。π²=a/b（a,b は正の整数）と仮定し、整数係数の多項式 f(x)=x^n(a-bx)^n/(b^n n!) を補助関数に使って、ある積分が整数でありながら0と1の間に入ることを示して矛盾を導く。
- 方針2: 方針を変更する。π²=a/b（a,b は正の整数）と仮定し、Niven型の sin 核を捨てて、端点 t=π の Taylor 係数が π の多項式として整数になる補助多項式を別に構成する。その積分恒等式から、整数でありながら 0 と 1 の間に入る量を導く。
- 方針3: π²=a/b（a,b は正の整数）と仮定し、sin 核を cos 核に替える。f(x)=x^n(a−bx²)^n/n! は偶多項式なので奇数階導関数は x=0 で消える。そこから I_n=∫_0^π f(x)cos x dx を部分積分で表し、整数であることと 0<I_n<1 の両立から矛盾を導く。端点 x=π での整
### e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable #9（gave_up）
- 方針1: 背理法で進める。π²=a/b（a,b は正の整数）と仮定し、Niven 型の補助多項式と積分恒等式を使って、整数であるべき量が 0 と 1 の間に入るという矛盾を導く。
- 方針2: 仮定 π²=a/b から、積分の整数性を Q(π)=Q+Qπ の中で追跡し直す。f^{(k)}(0) と f^{(k)}(π) は有理数と π の奇数倍の和として表されるので、π の奇数次の項を消す対称化を入れて、F(0)+F(π) が整数であることを示す。その後、0<I<1 の評価で矛盾を導く。
- 方針3: 方針3：補助関数 f を有理数係数（f∈Q[x]）に固定し、π と −π が Q 上の共役であることを使う。F(x)=Σ_j(−1)^j f^{(2j)}(x) の積分恒等式から I=∫_0^π f(x)sin x dx を F(0)、F(π)、F(−π) で表し、π の奇数部分（F(π)−F(−π) 側）を消す対称化
### e4-zeta3-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable #1（stopped_by_review）
- 方針1: Beukers型の二重積分による有理近似列を用いる。整数係数の多項式で定義した積分 I_n が a_n ζ(3) − b_n（a_n, b_n ∈ Z）の形になり、I_n ≠ 0 かつ lcm(1..n)^3 · |I_n| → 0 を示して、ζ(3) = p/q と仮定すると矛盾を導く。
- 方針2: 方針2：Beukers型の二重積分を捨て、Apéry型の三項漸化式から整数列と有理近似列を直接構成し、ζ(3)の無理数性を示す（前提は『積分の一般形を毎回手で確定する』から『漸化式の一度の検証で列全体を決める』へ変える）
### e4-zeta3-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable #2（stopped_by_review）
- 方針1: Apéry・Beukers 型の積分法で証明する。二重積分 ∫₀¹∫₀¹ (−log(xy))/(1−xy) dx dy を ζ(3) の定数倍として表し、整数係数の多項式で作った有理近似列 A_n ζ(3) − B_n を構成して、分母を揃えたときに 0 でない指数的に小さい値に押し込む。ζ(3) が p/q と書け
- 方針2: 方針1の重みを見直し、Beukers型の積分 I_n = ∫₀¹∫₀¹ (−log(xy))·(x(1−x)y(1−y))^n/(1−xy)^{n+1} dx dy を用いる。まずn=1で手計算により I_1 = a_1ζ(3)−b_1（a_1,b_1は有理数）を確認してから一般のnへ進み、d_n^3 倍で整数係数の線
- 方針3: Beukers型の二重積分を維持しつつ、重みの場当たり選択をやめる。重みは有理関数の対称性とルジャンドル型多項式の直交性から決め、ζ(2)項が消えることを一般のnについて示す。n=1,2の手計算は検証として使う。
### e4-zeta3-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #1（gave_up）
- 方針1: Beukers型の二重積分法を用いる。整数列 a_n, b_n を使って I_n = a_n ζ(3) − b_n と書き、I_n が 0 に超指数的に近づくことと分母の増大が e^{3n} 程度に抑えられることを示し、ζ(3) が有理数だと仮定して矛盾を導く。
- 方針2: Beukers型の二重積分を、核と多項式の組を一から定め直して組み立て直す。具体的には、シフト・ルジャンドル多項式 P_n と核 -log(xy)/(1-xy) を用い、I_n = q_n ζ(3) - p_n（p_n, q_n ∈ ℤ）の形を示すところから始める。その後、分母と大きさの評価、超指数的な減少、有理数仮定
- 方針3: 二重積分の核の組み替えを打ち切り、Apéry 型の三項漸化式に基づく有理近似列で証明する方針へ転換する。まず整数列 a_n, b_n を定義し、その漸化式と ζ(3) との関係式を検証する。次に分母の増大と誤差の超指数的減少を個別に評価し、ζ(3) が有理数と仮定して矛盾を導く。各主張は小さな n での手計算検証を経て
### e4-zeta3-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance #2（stopped_by_review）
- 方針1: Apéry型の証明を採用する。整数係数の多項式で定まる有理数列 p_n/q_n を作り、その積分表示から ζ(3) への近似誤差が非零かつ分母の増大に対して十分小さいことを示し、ζ(3) が有理数ではありえないことを背理法で導く。
- 方針2: これまでの二重積分の核の推測をやめ、Beukers型の三重積分を一般nの有理近似列として先に定式化し、ζ(2)項の消失、整数性、誤差評価、背理法の順に部品ごとに示す方針に切り替える。
- 方針3: 方針3：Beukers型の三重積分を一般nの線形形式として一度に定義し、核の個別計算をやめる。I_n=∫∫∫(x(1-x)y(1-y)z(1-z))^n/(1-(1-xy)z)^{n+1} dx dy dz について、I_n=A_nζ(3)-B_n（A_n,B_nは整数）の形を、部分分数と対称性を使って一般nで示す。そ
### e4-zeta3-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable #1（gave_up）
- 方針1: Beukers流の二重積分法で、ζ(3)に収束する有理近似列を構成し、Apéry型の不等式から無理数性を導く。
- 方針2: 二重積分の係数抽出を一般nで一気に行うのをやめ、Beukers型の近似を部品ごとに分けて、各部品を独立に検証できる形で進める。特に I_n=2(a_nζ(3)-b_n) の恒等式は、まずn=1の具体例で手計算して形を確認してから一般nに拡張する。
- 方針3: 核と近似構成を替える方針。被積分関数をBeukers型 R_n(x,y)=(x(1-x)y(1-y))^n/(1-xy)^{n+1} に固定し、二重積分 I_n=∫∫ -log(xy) R_n dxdy を有理数 p_n,q_n を用いて p_n ζ(3)-q_n の形に直す。その上で、分母の整数性、指数的減衰の上界、
### e4-zeta3-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable #2（stopped_by_review）
- 方針1: Beukers型の多重積分による線形形式近似（Apéryの方法）で ζ(3) の無理数性を示す。整数係数の線形形式 p_n ζ(3) − q_n を積分で表し、整数性・非零性・上界の指数評価を示し、有理数を仮定すると矛盾が出ることを導く。
- 方針2: Apéry型の線形形式を、積分の閉じた形を手で求める代わりに、Apéry数 a_n が満たす三項漸化式と整数係数の有理関数 R_n(t) の部分分数分解から組み立てる。整数性、非零性、上界の三点を個別に示し、有理数 ζ(3)=p/q を仮定して矛盾を導く。

## 追求あたりの方針の数
| 課題 × 構成 | 平均 | 内訳 |
| --- | --- | --- |
| a-contradictory-room generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 1.5 | 1 2 |
| a-missing-budget generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 1.5 | 1 2 |
| a-stale-supplier-price generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 1.0 | 1 1 |
| e4-pi-squared-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable | 2.8 | 3 2 3 3 3 3 3 3 2 3 |
| e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 2.2 | 3 1 2 2 1 3 3 3 3 1 |
| e4-pi-squared-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable | 2.3 | 1 3 3 3 2 2 2 1 3 3 |
| e4-zeta3-irrational generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable | 2.5 | 2 3 |
| e4-zeta3-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 3.0 | 3 3 |
| e4-zeta3-irrational generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable | 2.5 | 3 2 |

## 深さと部分点
| 課題 | 条件 | 構成 | n | 照合を通過 | 95% 区間 | 部分点 | 証明を書いた回数 | 方針の数 | 方針1 での試行 | 断念 / 停止 | 申告（通過 / 全体） | 申告漏れ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a-contradictory-room | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 2 | 0 | 0–66% | - | 0.00 | 1.50 | 6.00 | 0 / 2 | 0 / 0 | 0 |
| a-missing-budget | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 2 | 0 | 0–66% | - | 0.00 | 1.50 | 3.50 | 0 / 2 | 0 / 0 | 0 |
| a-stale-supplier-price | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 2 | 0 | 0–66% | - | 0.00 | 1.00 | 3.50 | 0 / 2 | 0 / 0 | 0 |
| e4-pi-squared-irrational | E3 | generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable | 10 | 3 | 11–60% | 0.50 | 10.90 | 2.80 | 8.00 | 3 / 2 | 3 / 3 | 2 |
| e4-pi-squared-irrational | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable | 10 | 3 | 11–60% | 0.60 | 7.20 | 2.30 | 3.70 | 2 / 2 | 3 / 5 | 2 |
| e4-pi-squared-irrational | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 10 | 6 | 31–83% | 0.64 | 5.30 | 2.20 | 6.30 | 3 / 1 | 6 / 7 | 0 |
| e4-zeta3-irrational | E3 | generator/T0/F-verified/P-v3/C/K-parts/V-claim/R-falsifiable | 2 | 0 | 0–66% | 0.00 | 9.50 | 2.50 | 6.00 | 0 / 2 | 0 / 0 | 0 |
| e4-zeta3-irrational | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable | 2 | 0 | 0–66% | 0.00 | 9.00 | 2.50 | 7.50 | 1 / 1 | 0 / 0 | 0 |
| e4-zeta3-irrational | E3 | generator/T0/F-verified/P-v3/K-parts/V-claim/R-falsifiable/A-acceptance | 2 | 0 | 0–66% | 0.00 | 9.50 | 3.00 | 8.50 | 1 / 1 | 0 / 0 | 0 |
