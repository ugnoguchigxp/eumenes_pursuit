import { describe, expect, test } from "bun:test";
import {
	assertProviderEndpoint,
	parseCatalog,
	selectProfileByCapability,
} from "../catalog.ts";

const provider = {
	name: "decision",
	capability: "decision.general",
	protocol: "larm.system-one.v1",
	endpoint: "/v1/systemone",
	model: "d1-3b-general",
	description: "…",
};

const catalogJson = {
	contractVersion: "agent-connection.v3",
	catalogRevision: "e2b9da83",
	profiles: [
		{ id: "training-like", schedulingPriority: 500, providers: [provider] },
		{
			id: "chat",
			schedulingPriority: 900,
			providers: [{ ...provider, capability: "llm.chat", name: "llm" }],
		},
		{
			id: "immediate-like",
			schedulingPriority: 1000,
			selectionPolicy: "explicit-only",
			providers: [provider],
		},
	],
	audiences: ["saaa-desktop", "same-host"],
};

describe("selectProfileByCapability", () => {
	test("picks the highest schedulingPriority carrying the capability", () => {
		const target = selectProfileByCapability(
			parseCatalog(catalogJson),
			"decision.general",
		);
		expect(target.profileId).toBe("immediate-like");
		expect(target.provider.model).toBe("d1-3b-general");
		expect(target.catalogRevision).toBe("e2b9da83");
	});

	test("missing capability and equal priorities are errors", () => {
		expect(() =>
			selectProfileByCapability(parseCatalog(catalogJson), "decision.none"),
		).toThrow("larm_catalog_provider_missing");
		const tied = {
			...catalogJson,
			profiles: catalogJson.profiles.map((p) => ({
				...p,
				schedulingPriority: 1,
			})),
		};
		expect(() =>
			selectProfileByCapability(parseCatalog(tied), "decision.general"),
		).toThrow("larm_catalog_ambiguous");
	});

	test("rejects another contract version", () => {
		expect(() =>
			parseCatalog({ ...catalogJson, contractVersion: "v2" }),
		).toThrow("larm_catalog_invalid");
	});
});

describe("assertProviderEndpoint", () => {
	const origin = new URL("http://192.168.0.130:9810");
	test("accepts the Control host with the catalog path", () => {
		expect(
			assertProviderEndpoint(
				"http://192.168.0.130:9810/v1/systemone",
				origin,
				"/v1/systemone",
			).href,
		).toBe("http://192.168.0.130:9810/v1/systemone");
	});
	test("rejects other hosts, credentials, queries and other paths", () => {
		const bad = (url: string) => () =>
			assertProviderEndpoint(url, origin, "/v1/systemone");
		expect(bad("http://127.0.0.1:9810/v1/systemone")).toThrow(
			"larm_provider_host_mismatch",
		);
		expect(bad("http://evil.example/v1/systemone")).toThrow(
			"larm_provider_host_mismatch",
		);
		expect(bad("http://u:p@192.168.0.130:9810/v1/systemone")).toThrow(
			"larm_provider_host_mismatch",
		);
		expect(bad("http://192.168.0.130:9810/v1/systemone?x=1")).toThrow(
			"larm_provider_host_mismatch",
		);
		expect(bad("ftp://192.168.0.130/v1/systemone")).toThrow(
			"larm_provider_host_mismatch",
		);
		expect(bad("not a url")).toThrow("larm_provider_host_mismatch");
		expect(bad("http://192.168.0.130:9810/v1/other")).toThrow(
			"larm_claim_endpoint_mismatch",
		);
	});
});
