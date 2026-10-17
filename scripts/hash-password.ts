// Prints an ADMIN_PASSWORD_HASH value for the given password.
// Usage: npm run hash-password            (prompts, input hidden)
//        echo -n "secret" | npm run hash-password
// Pipe straight into Wrangler (prompt goes to stderr, so only the hash reaches the pipe):
//        npm run --silent hash-password | npx wrangler secret put ADMIN_PASSWORD_HASH
import { createInterface } from 'node:readline';
import { hashPassword } from '../worker/lib/crypto.ts';

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks)
      .toString('utf8')
      .replace(/\r?\n$/, '');
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  process.stderr.write('Admin password: ');
  // Node has no public API for hidden input, so readline's private writer is silenced instead.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
  const answer = await new Promise<string>((resolve) => rl.question('', resolve));
  rl.close();
  process.stderr.write('\n');
  return answer;
}

const password = await readPassword();
if (password.length < 12) {
  console.error('Use a password of at least 12 characters.');
  process.exit(1);
}
const hash = await hashPassword(password);
// No trailing newline when piped, so the secret is exactly the hash.
process.stdout.write(process.stdout.isTTY ? `${hash}\n` : hash);
