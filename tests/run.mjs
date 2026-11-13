// Ejecuta los tests: `npm test`.
// Empaqueta cada tests/*.test.ts con esbuild (sustituyendo "obsidian" por tests/obsidian-stub.ts)
// en .test-build/ y los lanza con el ejecutor de tests de Node (node --test).
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outdir = path.join(root, ".test-build");
const files = readdirSync(path.join(root, "tests")).filter((f) => f.endsWith(".test.ts"));
if (!files.length) {
	console.error("No hay tests (tests/*.test.ts).");
	process.exit(1);
}

rmSync(outdir, { recursive: true, force: true });
await esbuild.build({
	absWorkingDir: root,
	entryPoints: files.map((f) => `tests/${f}`),
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node20",
	outdir,
	alias: { obsidian: path.join(root, "tests", "obsidian-stub.ts") },
	external: ["jsdom"],
	logLevel: "warning",
});

const result = spawnSync(process.execPath, ["--test", ...files.map((f) => path.join(outdir, f.replace(/\.ts$/, ".js")))], {
	cwd: root,
	stdio: "inherit",
});
process.exit(result.status ?? 1);
