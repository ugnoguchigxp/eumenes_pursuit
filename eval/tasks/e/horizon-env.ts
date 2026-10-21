import type { EvalTask } from "../../contracts.ts";
import { defineEnvTask } from "./env.ts";

/**
 * horizon-10e: work in a real sandboxed workspace (env.ts). Hidden checks and devices live only
 * in the host-only secret directory and run on the host after the executor claims completion.
 */
export const horizon10eTasks: readonly EvalTask[] = [
	defineEnvTask({
		id: "hz10e-room-utilization",
		level: 3,
		title: "会議室の利用率がときどき合わない",
		statement: [
			"work にある roomstats（会議室の予約記録から部屋ごとの利用時間と利用率を集計するツール。仕様は README.md）について、利用者から「一部の部屋で、利用時間や利用率の数字が実際と合わないことがある」と報告があった。見えているテスト（tests/）はすべて通っている。",
			"原因を突き止め、README.md の仕様どおりに動くよう直せ。仕様（README.md）と既存のテストは変えないこと。",
			"判定は、`python3 -m roomstats` に隠された入力を与えたときの出力が、仕様どおりの出力と一致するかで行う。",
		].join("\n"),
		traps: [
			"見えるテストが通ったことで直ったと判断する",
			"報告された症状の一つだけを直して終える",
			"テストや仕様を書き換えて辻褄を合わせる",
		],
		protectedPrefixes: ["tests/", "README.md"],
	}),
	defineEnvTask({
		id: "hz10e-window-sums",
		level: 3,
		title: "直近 1 時間の合計を速く",
		statement: [
			"work の windowsum.py（仕様は README.md）は正しい答えを出すが遅く、README.md の性能要件（N = 200000 で 1 回 3 秒以内）を満たさない。",
			"出力を変えずに、性能要件を満たすよう書き直せ。",
			"判定は、隠された入力（性能を測る大きな入力と、境界を確かめる小さな入力）に対する `python3 windowsum.py` の出力が仕様どおりで、各実行がホストで測って制限時間内に終わるかで行う。",
		].join("\n"),
		traps: [
			"小さい入力だけで速さを確かめる",
			"速くするときに同時刻・窓の端・負の金額・入力順の扱いを変えてしまう",
		],
		protectedPrefixes: ["tests/", "README.md"],
	}),
	defineEnvTask({
		id: "hz10e-black-box",
		level: 3,
		title: "黒箱の再現",
		statement: [
			"probe で問い合わせられる装置がある（説明は work の README.md）。装置の規則を実験で突き止め、装置と同じ値を返す work/predict.py を書け。",
			"判定は、隠された多数の入力に対する `python3 predict.py` の出力が、装置の出力とすべて一致するかで行う（検査のときに装置はない）。",
		].join("\n"),
		traps: [
			"問い合わせた入力だけに合う表を作る",
			"一部の文字や長さでしか確かめない",
		],
		protectedPrefixes: ["README.md"],
		probe: { maxCalls: 40, maxInputs: 25 },
	}),
	defineEnvTask({
		id: "hz10e-sales-pipeline",
		level: 3,
		title: "ときどき結果が変わる集計パイプライン",
		statement: [
			"work の売上集計パイプライン（`bash run.sh`、仕様は README.md）について、「同じデータなのに実行するたびに出力が変わることがある」「データを直したのに出力が古いままのことがある」と報告されている。",
			"根本原因を突き止めて直せ。仕様（README.md）と既存のテストは変えないこと。",
			"判定は、隠されたデータでパイプラインを何度も実行し（新しい状態からの実行、データを書き換えたあとの再実行を含む）、どの実行でも出力が仕様どおりかで行う。",
		].join("\n"),
		traps: [
			"一度か二度の実行で直ったと判断する",
			"症状を隠すだけ（出力を並べ替えて捨てる、build/ を消してから実行するよう run.sh を変える等で、原因を残す）",
		],
		protectedPrefixes: ["tests/", "README.md"],
	}),
];
