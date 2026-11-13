// Fails when an auth or jira-sync application service is below the agreed line coverage (T-40 / KAN-51).
// Runs after `jest --coverage`, which writes coverage/coverage-summary.json; the repo-wide 70 % gate
// lives in jest.config.js.
import { readFileSync } from 'node:fs';

const THRESHOLD = 85;
const SERVICE = /src[\\/]modules[\\/](auth|jira-sync)[\\/]application[\\/][^\\/]+\.service\.ts$/;

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const services = Object.entries(summary).filter(([file]) => SERVICE.test(file));
if (services.length === 0) {
  console.error(
    'check-service-coverage: no auth/jira-sync services in coverage/coverage-summary.json',
  );
  process.exit(1);
}

const failing = services.filter(([, { lines }]) => lines.pct < THRESHOLD);
for (const [file, { lines }] of services) {
  const mark = lines.pct < THRESHOLD ? 'FAIL' : 'ok  ';
  console.log(
    `${mark} ${String(lines.pct).padStart(6)} %  ${file.replace(/^.*?(src[\\/])/, '$1')}`,
  );
}
if (failing.length > 0) {
  console.error(
    `check-service-coverage: ${failing.length} service(s) below ${THRESHOLD} % line coverage`,
  );
  process.exit(1);
}
console.log(`check-service-coverage: ${services.length} services >= ${THRESHOLD} % lines`);
