// Secrets discipline for the worker (spine plan §E move 3, brief constraint
// "no credential in a .env, in a Slack message, or in plaintext anywhere").
//
// The host's secret store is the source of truth: Railway/Fly/ECS inject
// secrets as process env at start. A repo-adjacent .env file is a development
// convenience only. Outside development the worker refuses to start if one
// exists next to it, so a plaintext key can never ride along to a deploy.

import { access } from 'node:fs/promises';
import path from 'node:path';

const DEV = process.env.NODE_ENV === 'development' || process.env.WORKER_ENV === 'development';
const SECRET_FILES = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.production', '.env.production.local'];

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

export async function assertNoPlaintextSecretFile() {
  if (DEV) return;
  for (const name of SECRET_FILES) {
    if (await exists(path.resolve(process.cwd(), name))) {
      throw new Error(
        `Refusing to start: ${name} exists in ${process.cwd()}. Secrets must come from the host secret store ` +
          `(Railway/Fly/AWS Secrets Manager), not a file. Set WORKER_ENV=development to allow a local .env.`,
      );
    }
  }
}

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required secret ${name} (inject it from the host secret store).`);
  return v;
}
