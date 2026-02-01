// Minimal placeholder formatter check.
// Replace with prettier/eslint later.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const deny = [/\t/]; // tab char
const exts = [".ts", ".js", ".mjs", ".jsonc", ".md", ".css", ".html"];

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".wrangler" || ent.name === "dist") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (exts.includes(path.extname(ent.name))) checkFile(p);
  }
}

function checkFile(p) {
  const s = fs.readFileSync(p, "utf8");
  for (const r of deny) {
    if (r.test(s)) {
      console.error(`format-check failed: ${p} matched ${r}`);
      process.exitCode = 1;
      return;
    }
  }
}

walk(root);
if (process.exitCode) process.exit(process.exitCode);
console.log("format-check ok");
