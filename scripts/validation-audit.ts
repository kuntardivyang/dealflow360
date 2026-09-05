// Owner: B. Validation audit (feature 98): every server action and route handler must
// parse its input with a Zod schema (parseInput / safeParse / parse) before touching a
// service. Lists offenders and exits non-zero. Run: pnpm exec tsx scripts/validation-audit.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(process.cwd(), "src", "app");
const PARSERS = /parseInput\(|\.safeParse\(|\.parse\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/(actions?\.ts|actions\/[^/]+\.ts|route\.ts)$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const offenders: string[] = [];
const summary: string[] = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const isAction = src.includes('"use server"');
  const isRoute = /export async function (GET|POST|PUT|PATCH|DELETE)/.test(src);
  if (!isAction && !isRoute) continue;
  // Exported async functions that take an input parameter.
  const exported = [...src.matchAll(/export (?:async )?function (\w+)\(([^)]*)\)/g)];
  const withInput = exported.filter(([, , params]) => /\binput\b|FormData|Request/.test(params));
  const parses = PARSERS.test(src);
  const rel = relative(process.cwd(), file);
  summary.push(`${parses ? "ok  " : "MISS"} ${rel}  (${withInput.map(([, n]) => n).join(", ") || "no input-taking exports"})`);
  if (withInput.length > 0 && !parses) offenders.push(rel);
}
console.log(summary.sort().join("\n"));
if (offenders.length) {
  console.log(`\n${offenders.length} file(s) accept input without a Zod parse:\n- ${offenders.join("\n- ")}`);
  process.exit(1);
}
console.log(`\nAll ${summary.length} action/route files parse their input with Zod.`);
