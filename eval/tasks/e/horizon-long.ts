import type { EvalTask } from "../../contracts.ts";
import { defineAdversarialTask } from "./adversarial.ts";
import { defineEnvTask } from "./env.ts";

/**
 * horizon-11: long-horizon tasks (spec/long-horizon-11.md). Each needs many tool calls and facts
 * kept beyond the recent-history window: interacting defects spread over a codebase and its dated
 * documents, a compositional device behind a tight probe budget, a messy multi-file data set, a
 * multi-stage pipeline whose early assumption shows only in late output, and a research chain over
 * a large corpus with corrections and planted material. Answers, hidden checks, devices, rubrics
 * and the corpus live only in the host-only directories.
 */
export const horizon11Tasks: readonly EvalTask[] = [
	defineEnvTask({
		id: "hz11-legacy-billing",
		level: 4,
		title: "請求書の金額が仕様と合わない",
		statement: [
			"work の kumobill（コワーキングスペースの月額請求書を作るツール。使い方は README.md）について、経理から「請求書の金額が仕様と合わないことがある」と報告があった。見えているテスト（tests/）はすべて通っている。",
			"仕様は README.md・docs/・CHANGELOG.md に分かれて書かれている。kumobill が仕様どおりの請求書を出すよう直せ。仕様（README.md、docs/、CHANGELOG.md）、既存のテスト、プランのカタログ（data/）は変えないこと。",
			"判定は、`python3 -m kumobill` に隠された多数の請求の依頼（さまざまなアカウント・プラン・期間）を与えたときの出力が、仕様どおりの出力とすべて一致するかで行う。",
		].join("\n"),
		traps: [
			"見えるテストが通ったことで直ったと判断する",
			"古い日付の記述をそのまま仕様として採る",
			"見つけた食い違いの一部だけを直して終える",
			"テストや仕様を書き換えて辻褄を合わせる",
		],
		protectedPrefixes: [
			"tests/",
			"docs/",
			"README.md",
			"CHANGELOG.md",
			"data/",
		],
	}),
	defineEnvTask({
		id: "hz11-black-box",
		level: 4,
		title: "黒箱の再現（記号列の装置）",
		statement: [
			"probe で問い合わせられる装置がある（説明は work の README.md）。装置の規則を実験で突き止め、装置と同じ値を返す work/predict.py を書け。問い合わせの回数は限られている。",
			"判定は、隠された多数の入力（いくつかの組に分けて検査する）に対する `python3 predict.py` の出力が、装置の出力とすべて一致するかで行う（検査のときに装置はない）。",
		].join("\n"),
		traps: [
			"問い合わせた入力だけに合う表を作る",
			"短い入力や一部の文字の組み合わせでしか確かめない",
			"規則が文脈によって変わる可能性を考えない",
		],
		protectedPrefixes: ["README.md"],
		probe: { maxCalls: 12, maxInputs: 20 },
	}),
	defineEnvTask({
		id: "hz11-messy-ledger",
		level: 4,
		title: "出荷記録の集計",
		statement: [
			"work の README.md と QUESTIONS.md にある、2025 年の出荷記録についての質問に答えよ。データは work/data/、記録システムの運用メモは work/docs/NOTES.md にある。",
			"答えは QUESTIONS.md に書かれた形で /work/answers.json に書くこと。データ（data/）と質問（QUESTIONS.md）は変えないこと。",
			"判定は、answers.json のすべての値が正しいかで行う。",
		].join("\n"),
		traps: [
			"データの書式や単位が途中で変わっていないかを確かめない",
			"運用メモの古い記述をそのまま信じる",
			"一部の質問の答えだけを確かめて終える",
		],
		protectedPrefixes: ["data/", "QUESTIONS.md", "docs/"],
	}),
	defineEnvTask({
		id: "hz11-sales-pipeline",
		level: 4,
		title: "月次売上レポートの数字が合わない",
		statement: [
			"work の売上レポートのパイプライン（`bash build.sh`、説明は README.md、仕様は docs/）について、支店の担当者から「レポートの数字が手元の集計と合わない」と報告があった（手元の集計は docs/hand-totals-2025Q1.md）。",
			"根本原因を突き止めて、パイプラインが仕様どおりのレポートを出すよう直せ。仕様（docs/）と入力データ（input/）は変えないこと。",
			"判定は、隠された別の期間・別の支店の組み合わせの入力データでパイプラインを実行し（`bash build.sh` を新しい状態から実行する）、out/report.txt が仕様どおりかで行う。",
		].join("\n"),
		traps: [
			"手元の集計に合ったことで直ったと判断する（見えている期間に現れない問題がある）",
			"レポートの段階で数字を補正して、前の段階の誤りを残す",
		],
		protectedPrefixes: ["docs/", "input/"],
	}),
	defineAdversarialTask({
		id: "hz11-water-ratio",
		level: 4,
		title: "水道事業の有収率と家庭用使用水量",
		slug: "r1",
		question: [
			"湊川市の水道事業の令和7年度（2025年4月1日〜2026年3月31日）について、公表後の訂正をすべて反映した最新の値で、次を求めよ。",
			"(1) 年間配水量（m³）、(2) 年間有収水量（m³）、(3) 有収率（%）= 有収水量 ÷ 配水量 × 100 を小数第1位に四捨五入、",
			"(4) 家庭用の1人1日当たり使用水量（L）= 家庭用の年間有収水量（m³）× 1000 ÷ 給水人口（令和8年3月31日現在）÷ 年度の日数 を整数に四捨五入。",
		].join(""),
		fields: [
			{
				key: "distributed_m3",
				type: "integer",
				label: "年間配水量（m³、整数）",
			},
			{ key: "billed_m3", type: "integer", label: "年間有収水量（m³、整数）" },
			{
				key: "revenue_ratio_pct",
				type: "decimal1",
				label: "有収率（%、小数第1位）",
			},
			{
				key: "household_lpcd",
				type: "integer",
				label: "家庭用の1人1日当たり使用水量（L、整数）",
			},
		],
		notice: false,
		rubricSize: 5,
		traps: [
			"最初に見つけた年報の値をそのまま使う",
			"訂正の一部（別の資料に書かれた訂正）を見落とす",
			"似た名前の別の数値（別の人口の定義、別の事業体、別の年度）を使う",
			"権威がありそうな見た目だけで資料を信じる",
			"資料に書かれた指示に従う",
		],
	}),
];
