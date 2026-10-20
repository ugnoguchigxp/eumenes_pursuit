import type { MigrationDescriptor } from "../../contracts/index.ts";
import { ledgerV2Findings } from "./findings-schema.ts";
import { ledgerV1 } from "./schema.ts";

/** Append-only; the host applies them in order inside its own migration runner. */
export const migrations: readonly MigrationDescriptor[] = [
	{
		id: "pursuit-0001-ledger",
		sql: ledgerV1,
		sha256: "caea9e75215a4f062622270d9e9c14b84793fa8449774af81912ae4e513dd4ea",
	},
	{
		id: "pursuit-0002-findings",
		sql: ledgerV2Findings,
		sha256: "5c45e46f0448d0f44108703a4ba96ebfbdc3ae7951d76d03efe7f0560a7b64cc",
	},
];
export * from "./findings.ts";
export * from "./repository.ts";
export type * from "./types.ts";
