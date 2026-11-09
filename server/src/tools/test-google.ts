// Test keys and ID tokens standing in for Google's, for local relays and headless sign-in checks.
// A production relay never accepts these: it uses Google's keys (GOOGLE_JWKS_FILE is ignored in production).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { generateTestKey, loadTestKey, mintIdToken, testJwks } from '../auth/testKeys';

const USAGE = `Test Google keys and ID tokens for a LOCAL relay.

Usage:
  npm run test-google -- keys --out <dir>
      Writes <dir>/jwks.json (start the relay with GOOGLE_JWKS_FILE=<dir>/jwks.json) and
      <dir>/private-key.pem + <dir>/kid.txt (used by the token command). Keep <dir> out of the repository.

  npm run test-google -- token --dir <dir> --aud <GOOGLE_CLIENT_ID> [options]
      Prints one signed ID token.
      --email <addr>     default player@example.com (use made-up example.com addresses only)
      --given <name>     given_name claim (the first name players see)
      --sub <id>         subject (default 100000000000000000001)
      --ttl=<seconds>    lifetime (default 3600; negative = already expired, e.g. --ttl=-60)
      --unverified       email_verified: false

Example local relay (ports and values are examples):
  GOOGLE_CLIENT_ID=local-test-client.example.com GOOGLE_JWKS_FILE=/tmp/keys/jwks.json \\
  ADMIN_KEY=<24+ characters> ADMIN_EMAILS=owner@example.com \\
  npm start -- --host 127.0.0.1 --port 19601
`;

function fail(message: string): never {
  console.error(`error: ${message}\n\n${USAGE}`);
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    allowNegative: false,
    strict: true,
    options: {
      out: { type: 'string' },
      dir: { type: 'string' },
      aud: { type: 'string' },
      email: { type: 'string' },
      given: { type: 'string' },
      sub: { type: 'string' },
      ttl: { type: 'string' },
      unverified: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
} catch (err) {
  fail((err as Error).message);
}
const { values, positionals } = parsed;
if (values.help || positionals.length === 0) {
  console.log(USAGE);
  process.exit(0);
}

const command = positionals[0];
if (command === 'keys') {
  if (!values.out) fail('keys needs --out <dir>');
  const key = generateTestKey(`local-test-${Date.now().toString(36)}`);
  mkdirSync(values.out, { recursive: true });
  writeFileSync(join(values.out, 'jwks.json'), `${JSON.stringify(testJwks(key), null, 2)}\n`);
  writeFileSync(join(values.out, 'private-key.pem'), key.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string, { mode: 0o600 });
  writeFileSync(join(values.out, 'kid.txt'), `${key.kid}\n`);
  console.log(`wrote ${join(values.out, 'jwks.json')}, private-key.pem and kid.txt (kid ${key.kid})`);
} else if (command === 'token') {
  if (!values.dir || !values.aud) fail('token needs --dir <dir> and --aud <client id>');
  if (values.email && !/@example\.(com|org|net)$/i.test(values.email)) fail('use a made-up address on example.com for test tokens');
  const kid = readFileSync(join(values.dir, 'kid.txt'), 'utf8').trim();
  const key = loadTestKey(readFileSync(join(values.dir, 'private-key.pem'), 'utf8'), kid);
  const ttl = values.ttl === undefined ? 3600 : Number(values.ttl);
  if (!Number.isFinite(ttl)) fail('--ttl must be a number of seconds');
  process.stdout.write(
    `${mintIdToken(key, {
      aud: values.aud,
      email: values.email ?? 'player@example.com',
      emailVerified: !values.unverified,
      ...(values.given === undefined ? {} : { givenName: values.given }),
      ...(values.sub === undefined ? {} : { sub: values.sub }),
      ttlSec: ttl,
    })}\n`,
  );
} else {
  fail(`unknown command "${command}"`);
}
