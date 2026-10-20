import { z } from "zod";
import { type Control, LarmControlError } from "./control.ts";

const catalogProviderSchema = z.object({
	name: z.string().min(1),
	capability: z.string(),
	protocol: z.string(),
	endpoint: z.string(),
	model: z.string(),
});

const catalogSchema = z.object({
	contractVersion: z.literal("agent-connection.v3"),
	catalogRevision: z.string().min(1),
	profiles: z.array(
		z.object({
			id: z.string().min(1),
			schedulingPriority: z.number().optional(),
			providers: z.array(catalogProviderSchema),
		}),
	),
	audiences: z.array(z.string()).optional(),
});

export type CatalogProvider = z.infer<typeof catalogProviderSchema>;
export type Catalog = z.infer<typeof catalogSchema>;

export interface DecisionTarget {
	readonly catalogRevision: string;
	/** Profile id found by capability (verification only; creation uses the saved selector). */
	readonly profileId: string;
	readonly provider: CatalogProvider;
}

export const DECISION_CAPABILITY = "decision.general";

export function parseCatalog(raw: unknown): Catalog {
	const parsed = catalogSchema.safeParse(raw);
	if (!parsed.success) throw new LarmControlError("larm_catalog_invalid");
	return parsed.data;
}

/**
 * Picks the profile that carries `capability` with the highest schedulingPriority.
 * Profile ids and model names are never hardcoded; they come from the catalog.
 */
export function selectProfileByCapability(
	catalog: Catalog,
	capability: string,
): DecisionTarget {
	const candidates: {
		profileId: string;
		priority: number;
		provider: CatalogProvider;
	}[] = [];
	for (const profile of catalog.profiles) {
		const provider = profile.providers.find((p) => p.capability === capability);
		if (provider)
			candidates.push({
				profileId: profile.id,
				priority: profile.schedulingPriority ?? 0,
				provider,
			});
	}
	if (candidates.length === 0)
		throw new LarmControlError("larm_catalog_provider_missing");
	candidates.sort((a, b) => b.priority - a.priority);
	const best = candidates[0];
	const second = candidates[1];
	if (!best) throw new LarmControlError("larm_catalog_provider_missing");
	if (second && second.priority === best.priority)
		throw new LarmControlError("larm_catalog_ambiguous");
	return {
		catalogRevision: catalog.catalogRevision,
		profileId: best.profileId,
		provider: best.provider,
	};
}

export async function discoverTarget(
	control: Control,
	capability: string = DECISION_CAPABILITY,
	signal?: AbortSignal,
): Promise<DecisionTarget> {
	const raw = await control.json(
		"/v3/agent-profiles",
		signal ? { signal } : {},
	);
	return selectProfileByCapability(parseCatalog(raw), capability);
}

/**
 * The claimed endpoint may receive the provider token only when its host equals the
 * Control origin host, it carries no credentials/query, and its path is the catalog's.
 */
export function assertProviderEndpoint(
	endpoint: string,
	origin: URL,
	expectedPath: string,
): URL {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw new LarmControlError("larm_provider_host_mismatch");
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username !== "" ||
		url.password !== "" ||
		url.search !== "" ||
		url.hash !== "" ||
		url.hostname.toLowerCase() !== origin.hostname.toLowerCase()
	)
		throw new LarmControlError("larm_provider_host_mismatch");
	if (url.pathname !== expectedPath)
		throw new LarmControlError("larm_claim_endpoint_mismatch");
	return url;
}
