// Per-module line-coverage gates, run after `jest --coverage` (which writes coverage/coverage-summary.json).
// The repo-wide 70 % gate lives in jest.config.js; a Jest path/glob threshold would take these files out
// of that global pool, so the finer rules are checked here instead (T-40 / KAN-51, T-55 / KAN-66).
//
// Rules:
//  - auth + jira-sync application services: every service file >= 85 % lines (KAN-51)
//  - boards application services: every service file >= 80 % lines, and the whole boards module
//    (all files under src/modules/boards) >= 90 % lines (KAN-66)
// The result of each rule is printed, so it is visible in the CI log.
import { readFileSync } from 'node:fs';

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const short = (file) => file.replace(/^.*?(src[\\/])/, '$1');

const RULES = [
  {
    name: 'auth + jira-sync services',
    files: /src[\\/]modules[\\/](auth|jira-sync)[\\/]application[\\/][^\\/]+\.service\.ts$/,
    each: 85,
  },
  {
    name: 'boards services',
    files: /src[\\/]modules[\\/]boards[\\/]application[\\/][^\\/]+\.service\.ts$/,
    each: 80,
  },
  {
    name: 'boards module (all files)',
    files: /src[\\/]modules[\\/]boards[\\/]/,
    total: 90,
  },
];

let failed = false;
for (const { name, files, each, total } of RULES) {
  const matched = Object.entries(summary).filter(([file]) => file !== 'total' && files.test(file));
  if (matched.length === 0) {
    console.error(
      `check-service-coverage: no files for "${name}" in coverage/coverage-summary.json`,
    );
    process.exit(1);
  }
  console.log(`\n${name}`);
  if (each !== undefined) {
    for (const [file, { lines }] of matched) {
      const bad = lines.pct < each;
      failed ||= bad;
      console.log(`  ${bad ? 'FAIL' : 'ok  '} ${String(lines.pct).padStart(6)} %  ${short(file)}`);
    }
    console.log(`  rule: every file >= ${each} % lines (${matched.length} files)`);
  }
  if (total !== undefined) {
    const sum = (key) => matched.reduce((n, [, { lines }]) => n + lines[key], 0);
    const pct = Math.round((sum('covered') / sum('total')) * 10000) / 100;
    const bad = pct < total;
    failed ||= bad;
    console.log(
      `  ${bad ? 'FAIL' : 'ok  '} ${String(pct).padStart(6)} %  ${matched.length} files, ${sum('covered')}/${sum('total')} lines  (rule: >= ${total} %)`,
    );
  }
}
if (failed) {
  console.error('\ncheck-service-coverage: coverage rule(s) failed');
  process.exit(1);
}
console.log('\ncheck-service-coverage: all rules met');
