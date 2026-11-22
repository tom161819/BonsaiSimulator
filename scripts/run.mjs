// Spustí TypeScript skript v Node: node scripts/run.mjs scripts/calibrate.ts [args]
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
const [file, ...rest] = process.argv.slice(2);
const out = `node_modules/.cache/run-${Date.now()}.mjs`;
await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
process.argv = [process.argv[0], file, ...rest];
await import(pathToFileURL(out).href);
