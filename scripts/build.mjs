// Sestavení: src/main.ts -> dist/app.js, src/page.html -> dist/index.html (+ dist/artifact.html bez obálky).
// `node scripts/build.mjs --serve` spustí vývojový server s průběžným překladem.
import { build, context } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const serve = process.argv.includes('--serve');
// online funkce (Supabase): adresa projektu a veřejný klíč z online.config.json, přepíší je proměnné prostředí
// SUPABASE_URL / SUPABASE_ANON_KEY; BONSAI_OFFLINE=1 sestaví hru bez online části (verze pro claude.ai)
const cfg = existsSync('online.config.json') ? JSON.parse(readFileSync('online.config.json', 'utf8')) : {};
const offline = process.env.BONSAI_OFFLINE === '1';
const sbUrl = offline ? '' : process.env.SUPABASE_URL || cfg.url || '';
const sbKey = offline ? '' : process.env.SUPABASE_ANON_KEY || cfg.anonKey || '';
const opts = {
  entryPoints: ['src/main.ts'], bundle: true, format: 'iife', minify: !serve, sourcemap: serve, target: 'es2020', outfile: 'dist/app.js', logLevel: 'info',
  define: { __SUPABASE_URL__: JSON.stringify(sbUrl), __SUPABASE_ANON_KEY__: JSON.stringify(sbKey) },
};
console.log(sbUrl ? `online: ${sbUrl}` : 'online: vypnuto (stromy jen v prohlížeči)');
mkdirSync('dist', { recursive: true });
cpSync('assets/tex', 'dist/tex', { recursive: true, filter: (f) => !f.endsWith('.md') });
const page = readFileSync('src/page.html', 'utf8');
writeFileSync('dist/artifact.html', page);
writeFileSync('dist/index.html', `<!doctype html>\n<html lang="cs">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n${page}</body>\n</html>\n`);
if (serve) {
  const ctx = await context(opts);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist', port: 5173 });
  console.log(`http://localhost:${port}`);
} else await build(opts);
