import type { EvalTask } from "../../contracts.ts";
import { defineContestedTask } from "./contested.ts";

/**
 * horizon-9: contested questions. The faction maps and rubrics are not in this repository
 * (`<--rubric-dir>/<id>.json`, read by the host only when grading).
 */
const traps = [
	"一方の陣営の資料だけを集める",
	"優勢の基準を述べない、または途中で変える",
	"検索結果の要約や自分の言い換えを引用として書く（本文に見つからない）",
];
const common = {
	level: 4,
	minSources: 12,
	minSites: 8,
	quoteThreshold: 0.7,
	rubricSize: 6,
	traps,
} as const;

export const horizon9Tasks: readonly EvalTask[] = [
	defineContestedTask({
		...common,
		id: "hz9-ai-scaling-agi",
		title: "LLM の延長で AGI に届くか",
		question:
			"現在の大規模言語モデルの路線（大規模な事前学習のスケーリングに、強化学習による事後学習や推論時の計算量の拡大を加えたもの）を延長することで、AGI 級の能力（人間の専門家が行う認知的な作業の大部分を同等以上にこなせる水準）に到達できるか。",
		scope:
			"範囲: AI 研究者（学術・企業）、主要な AI 企業の経営者・研究責任者、批判的な研究者、研究者を対象とした調査を含める。主に 2024 年以降の議論を扱う。AGI の定義の違いが立場の違いにどう効いているかも整理すること。",
	}),
	defineContestedTask({
		...common,
		id: "hz9-psa-screening",
		title: "PSA による前立腺がん検診を集団に勧めるべきか",
		question:
			"症状のない平均的なリスクの男性（おおむね 50〜69 歳）に対して、PSA 検査による前立腺がん検診を、集団を対象とする検診（対策型・組織型検診）として勧めるべきか。",
		scope:
			"範囲: 日本（厚生労働省、国立がん研究センター、日本泌尿器科学会など）と海外（米国、欧州、英国など）のガイドライン策定機関・行政の立場、主要な無作為化比較試験とメタ分析を含める。MRI やリスク層別化を組み合わせた新しい検診方式も扱うこと。",
	}),
	defineContestedTask({
		...common,
		id: "hz9-japan-surname",
		title: "選択的夫婦別姓制度を導入すべきか",
		question:
			"日本で選択的夫婦別姓制度を導入すべきか。現行の夫婦同氏制度を維持する立場、旧姓（旧氏）の通称使用を法制化して対応する立場との比較を含めて評価せよ。",
		scope:
			"範囲: 政党と国会に提出された法案、政府（内閣府）の世論調査と報道機関の世論調査、経済団体・法曹団体・市民団体・宗教団体などの立場、最高裁判所の判断、国連女性差別撤廃委員会の勧告などを含める。",
	}),
];
