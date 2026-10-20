import type { JsonObject } from "./json.ts";

/** d1 question shapes (LARM `larm.system-one.v1`). Ids and choice names are ASCII identifiers. */
export type Question =
	| { readonly type: "noul"; readonly instructions: string }
	| {
			readonly type: "choice";
			readonly instructions: string;
			readonly criteria: Readonly<Record<string, string>>;
	  }
	| {
			readonly type: "score";
			readonly instructions: string;
			/** 2..10 levels; answers are 0-based. */
			readonly criteria: readonly string[];
	  };

export type Answer =
	| {
			readonly type: "noul";
			readonly pYes: number;
			readonly confidence: number;
	  }
	| {
			readonly type: "choice";
			readonly choice: string;
			readonly confidence: number;
			readonly probabilities: Readonly<Record<string, number>>;
	  }
	| {
			readonly type: "score";
			/** 0-based expected level. */
			readonly score: number;
			readonly confidence: number;
			readonly probabilities: readonly number[];
	  };

export interface VersionRef {
	readonly id: string;
	readonly version: number;
}

export interface JudgeRequest {
	readonly state: JsonObject;
	readonly questions: Readonly<Record<string, Question>>;
	readonly questionSet: VersionRef;
	readonly adapter: VersionRef | null;
}

export interface JudgeResponse {
	readonly answers: Readonly<Record<string, Answer>>;
	readonly model: string;
	readonly adapter: VersionRef | null;
	readonly inputTokens: number;
	readonly latencyMs: number;
}

/** Host-side judge (d1 on LARM). At most `maxQuestions` per request. */
export interface JudgePort {
	readonly maxQuestions: number;
	ask(request: JudgeRequest, signal: AbortSignal): Promise<JudgeResponse>;
}
