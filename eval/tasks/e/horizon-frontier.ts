import type { EvalTask } from "../../contracts.ts";
import { defineEnvTask } from "./env.ts";

/**
 * horizon-13: problems near the limit of the solving model, one each from mathematics,
 * physics and chemistry. Each has six tiers of hidden checks (two files per tier), so the
 * count of passed checks shows how far the approach reached. The references and the case
 * generator are in frontier/; the hidden cases are built by frontier/build-secrets.py.
 */
const frontier = (
	id: string,
	title: string,
	subject: string,
	traps: readonly string[],
) =>
	defineEnvTask({
		id,
		level: 4,
		title,
		statement: [
			`work の README.md に定義した${subject}を解くプログラム work/solve.py を書け。`,
			"README.md の入力の範囲は6段階ある。すべての段階の入力に正しく答えること。samples/ には段階1の入力と正しい出力だけがある。それより先の段階は、自分で正しさを確かめる方法を考えて検証せよ。",
			"判定は、段階ごとの隠された入力に対する `python3 solve.py` の出力が、正しい出力とすべて一致するかで行う。README.md と samples/ は変えないこと。",
			"一度に出す操作（actions）が2件以上なら、必ず sequence=true にして順に実行すること。list_files・read_file・write_file・run は作業領域に依存するので、並行（sequence=false）では出せない。",
		].join("\n"),
		traps,
		protectedPrefixes: ["README.md", "samples/"],
		tiers: 6,
	});

export const horizon13Tasks: readonly EvalTask[] = [
	frontier(
		"hz13-bracelets",
		"向きのある隣接条件つきブレスレットの数え上げ",
		"数え上げの問題",
		[
			"A が非対称のとき、裏返した塗り方が適合しなくなることを見落とす",
			"小さな n の全列挙と照合せずに公式を信じる",
			"2n の逆元が M を法として存在しない場合を扱わない",
			"10^18 までの n の約数を求める方法を用意しない",
			"巡回行列を k×k の行列のまま冪乗しようとする",
		],
	),
	frontier(
		"hz13-ising-ring",
		"横磁場イジング環の有限サイズの厳密な値",
		"量子スピン系の問題",
		[
			"熱力学極限や片方の境界条件だけの式を有限の環に使う",
			"パリティの制約を課さずに準粒子の占有を数える",
			"J < 0 で L が奇数の環を、符号を付け替えた強磁性の環と同じに扱う",
			"指数的に小さい準位差を倍精度の引き算で求める",
			"長い環でも運動量を一つずつ足し上げようとする",
		],
	),
	frontier("hz13-equilibrium", "沈殿を含む水溶液の化学平衡", "化学平衡の問題", [
		"過飽和になった固相を足すだけで、溶け切る固相を外さない",
		"活量係数とイオン強度を自己無撞着に解かない",
		"何十桁も違う濃度を線形のまま反復して発散させる",
		"物質収支・飽和指数・固相の量の符号を解の検算に使わない",
		"大きな系で制限時間に収まるかを測らない",
	]),
];
