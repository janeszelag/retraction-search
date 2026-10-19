// npm run check:search [-- --server-env <file>] (spec 002 task 21, spec 004
// task 7). Runs the search checks against the Typesense server and key in that
// env file, such as .env.hosted for the hosted server. Without the option, the
// checks use the repository's .env.local, as the site does.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const webDir = fileURLToPath(new URL('../', import.meta.url));
// Not --env-file: Node checks a path given with that name itself (see pipeline/src/update.js).
const { values } = parseArgs({ options: { 'server-env': { type: 'string' } } });

const env = { ...process.env };
if (values['server-env']) {
  // npm runs workspace scripts from web/, but INIT_CWD is where the command was typed.
  env.CHECK_SERVER_ENV = path.resolve(process.env.INIT_CWD ?? process.cwd(), values['server-env']);
}
const vitest = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
const child = spawn(process.execPath, [vitest, 'run', '--config', 'vitest.checks.config.ts'], { cwd: webDir, env, stdio: 'inherit' });
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
