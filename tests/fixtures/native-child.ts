import { writeFile } from 'node:fs/promises';

const output = process.argv[2];
if (!output) throw new Error('Missing native child evidence destination.');
process.stdout.write('application stdout must not become native evidence\n');
process.stderr.write('application stderr must remain private\n');
const inputEnded = await Promise.race([
    new Promise<boolean>((resolve) => {
        process.stdin.once('end', () => resolve(true));
        process.stdin.once('error', () => resolve(false));
        process.stdin.resume();
    }),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 400)),
]);
process.stdin.destroy();
await writeFile(
    output,
    JSON.stringify({
        pid: process.pid,
        parent: process.ppid,
        cwd: process.cwd(),
        args: process.argv.slice(3),
        environment: process.env.DCT_TEST_NATIVE,
        inputEnded,
    }),
    'utf8',
);
await new Promise((resolve) => setTimeout(resolve, 200));
