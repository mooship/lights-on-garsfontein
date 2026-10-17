// Prints an ADMIN_PASSWORD_HASH value for the given password.
// Usage: npm run hash-password            (prompts, input hidden)
//        echo -n "secret" | npm run hash-password
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
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  process.stdout.write('Admin password: ');
  // Mute echo while the password is typed.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
  const answer = await new Promise<string>((resolve) => rl.question('', resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const password = await readPassword();
if (password.length < 12) {
  console.error('Use a password of at least 12 characters.');
  process.exit(1);
}
console.log(await hashPassword(password));
