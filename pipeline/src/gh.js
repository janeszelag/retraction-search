// Runs the GitHub CLI and returns what it printed. In a workflow, GH_TOKEN and
// GH_REPO tell it which repository to act on. alert.js and keepalive.js take a
// stand-in for it in tests.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function ghCli(args) {
  const { stdout } = await promisify(execFile)('gh', args);
  return stdout;
}
