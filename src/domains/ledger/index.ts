import { ledgerV5FindingSources } from "./finding-sources-schema.ts";
import type { MigrationDescriptor } from "../../contracts/index.ts";
import { ledgerV2Findings } from "./findings-schema.ts";
import { ledgerV3Parts } from "./parts-schema.ts";
import { ledgerV4Settlement } from "./settlement-schema.ts";
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
	{
		id: "pursuit-0003-parts",
		sql: ledgerV3Parts,
		sha256: "79653d2dfb89864bdd9ed2f22d05a2f55822f2c9efe3ac77f7b4a291a7a79cb6",
	},
	{
		id: "pursuit-0004-settlement",
		sql: ledgerV4Settlement,
		sha256: "c7af35e2971ff35b21f96a8312c61940561a81ba6ca3aa9813fbecc9ede1336b",
	},
	{
		id: "pursuit-0005-finding-sources",
		sql: ledgerV5FindingSources,
		sha256: "5b8d4499ad9382fe54118585cdf4c6a3c50b5be6de329addd19f96f28ed6f9b0",
	},
];
export * from "./findings.ts";
export * from "./repository.ts";
export type * from "./types.ts";
