import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyPackage } from "../../scripts/pack-core.ts";

test("compiled package is complete, detects tampering, and runs in a clean host", async () => {
	const root = resolve(import.meta.dir, "../.."),
		base = await mkdtemp(join(tmpdir(), "package-consumer-"));
	try {
		const tar = join(base, "core.tgz");
		const pack = Bun.spawn([process.execPath, "scripts/pack-core.ts", tar], {
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
		});
		const errors = await new Response(pack.stderr).text();
		expect(await pack.exited, errors).toBe(0);
		const other = join(base, "repeat.tgz");
		const repeat = Bun.spawn(
			[process.execPath, "scripts/pack-core.ts", other],
			{
				cwd: root,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const repeatErrors = await new Response(repeat.stderr).text();
		expect(await repeat.exited, repeatErrors).toBe(0);
		expect((await readFile(other)).equals(await readFile(tar))).toBe(true);
		const listing = Bun.spawnSync(["tar", "-tzf", tar], {
			env: { ...process.env, COPYFILE_DISABLE: "1" },
		});
		expect(listing.exitCode).toBe(0);
		for (const file of listing.stdout.toString().trim().split("\n")) {
			expect(file.startsWith("package/")).toBe(true);
			expect(file).not.toContain("..");
			expect(file.split("/").some((part) => part.startsWith("._"))).toBe(false);
			expect(file).not.toMatch(
				/(?:standalone|eval|\.env|\.sqlite|node_modules)\//,
			);
		}
		expect(Bun.spawnSync(["tar", "-xzf", tar, "-C", base]).exitCode).toBe(0);
		const dir = join(base, "package");
		await verifyPackage(dir);
		const index = join(dir, "dist/index.js"),
			content = await readFile(index, "utf8");
		await writeFile(index, content + "\n//tampered\n");
		await expect(verifyPackage(dir)).rejects.toThrow("checksum");
		await writeFile(index, content);
		await verifyPackage(dir);
		const consumer = join(base, "consumer");
		await mkdir(consumer);
		await writeFile(
			join(consumer, "package.json"),
			JSON.stringify({
				private: true,
				type: "module",
				dependencies: { "eumenes-pursuit": `file:${tar}` },
			}),
		);
		const install = Bun.spawn(
			[process.execPath, "install", "--ignore-scripts"],
			{
				cwd: consumer,
				stdout: "pipe",
				stderr: "pipe",
				env: { PATH: process.env.PATH!, HOME: base },
			},
		);
		expect(await install.exited).toBe(0);
		await writeFile(
			join(consumer, "smoke.ts"),
			`import {Database} from 'bun:sqlite';
import {createPursuitEngine} from 'eumenes-pursuit';
import {migrations} from 'eumenes-pursuit/sqlite';
const db=new Database('state.sqlite');db.exec('PRAGMA foreign_keys=ON');
for(const m of migrations){if(new Bun.CryptoHasher('sha256').update(m.sql).digest('hex')!==m.sha256)throw new Error('migration checksum');db.exec(m.sql);}
const store={write:async(op)=>db.transaction(()=>op(db)).immediate(),readSnapshot:async(op)=>db.transaction(()=>op(db)).deferred()};
const generator={complete:async(r)=>({value:r.schema.parse(r.purpose==='plan'?{strategy:'s',rationale:'r',alternatives:[]}:r.purpose==='hypothesize'?{hypothesis:'h',rationale:'r',tools:[],expected:'e'}:{kind:'done',tool:null,inputJson:null,text:null,expectedStatus:null,expectedObservation:null,whatChanged:'',message:'done',missing:''}),model:'fixture',inputTokens:0,outputTokens:0,cacheReadTokens:0,latencyMs:0})};
const engine=createPursuitEngine({store,generator,reviewer:null,judge:null,clock:{now:()=>Date.now()},ids:{next:p=>p+crypto.randomUUID()}});
const input=${JSON.stringify((await import("../support.ts")).startInput())};
const {pursuitId}=await engine.start(input,'consumer');
const runtime={workspace:null,tools:{list:()=>[],invoke:async()=>{throw new Error('no tool needed')}},acceptance:{verify:async()=>[{id:'total',passed:true,evidence:'host checked'}]}};
for(let i=0;i<3;i++)await engine.step(pursuitId,runtime,AbortSignal.timeout(1000));
if((await engine.view(pursuitId)).status!=='completed')throw new Error('not completed');
db.close();console.log('clean consumer passed');`,
		);
		const smoke = Bun.spawn([process.execPath, "smoke.ts"], {
			cwd: consumer,
			stdout: "pipe",
			stderr: "pipe",
			env: { PATH: process.env.PATH!, HOME: base },
		});
		const stderr = await new Response(smoke.stderr).text();
		expect(await smoke.exited, stderr).toBe(0);
		expect(await new Response(smoke.stdout).text()).toContain(
			"clean consumer passed",
		);
	} finally {
		await rm(base, { recursive: true, force: true });
	}
}, 30000);
