// Stamps one version number on every script and stylesheet the site loads,
// so browsers fetch a release's files together instead of mixing a new page
// with cached older modules. Run after changing any JS or CSS:
//   node geobarkr/dev/version.mjs          (bumps by one)
//   node geobarkr/dev/version.mjs 12       (sets 12)
// It rewrites ?v=N in the pages and the relative imports inside js/.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const walk = (dir, ext) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return ["dev", "vendor", "tests", "supabase", "docs", "node_modules"].includes(e.name) ? [] : walk(p, ext);
  return p.endsWith(ext) ? [p] : [];
});

const pages = walk(root, ".html");
const scripts = walk(path.join(root, "js"), ".js");
const current = Math.max(0, ...pages.flatMap((p) => [...fs.readFileSync(p, "utf8").matchAll(/\?v=(\d+)/g)].map((m) => Number(m[1]))));
const version = Number(process.argv[2]) || current + 1;

for (const p of pages) {
  const before = fs.readFileSync(p, "utf8");
  const after = before.replace(/(\/geobarkr\/(?:js|css)\/[\w/.-]+\.(?:js|css))(\?v=\d+)?"/g, `$1?v=${version}"`);
  if (after !== before) fs.writeFileSync(p, after);
}
for (const p of scripts) {
  const before = fs.readFileSync(p, "utf8");
  const after = before
    .replace(/(from\s+"\.\.?\/[\w/.-]+\.js)(\?v=\d+)?"/g, `$1?v=${version}"`)
    .replace(/(import\(\s*"\.\.?\/[\w/.-]+\.js)(\?v=\d+)?"/g, `$1?v=${version}"`);
  if (after !== before) fs.writeFileSync(p, after);
}
console.log(`GeoBarkr assets now at v=${version}`);
