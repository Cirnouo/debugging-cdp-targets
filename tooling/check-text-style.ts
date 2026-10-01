import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { validateTextStyle } from './repository-audit.ts';

const root = process.cwd();
const errors = [];
for (const argument of process.argv.slice(2)) {
    const absolute = path.resolve(root, argument);
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    errors.push(...validateTextStyle(relative, readFileSync(absolute, 'utf8')));
}

if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join('\n'));
    process.exitCode = 1;
}
