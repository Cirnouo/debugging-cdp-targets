import path from 'node:path';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GUI_SKIP_REASON, guiAuthorization } from '../tests/gui-authorization.ts';

export function runInteractiveTests(args: string[], files?: string[]) {
    if (!guiAuthorization(args).allowed) {
        console.log(`SKIP: ${GUI_SKIP_REASON}`);
        return;
    }
    const stream = run({
        files:
            files ??
            ['screenshot-background-anchor', 'window-evidence', 'windows-native', 'windows-normal-close'].map((name) =>
                fileURLToPath(new URL(`../tests/interactive/${name}.test.ts`, import.meta.url)),
            ),
        concurrency: 1,
        argv: args,
    });
    stream.on('test:fail', () => {
        process.exitCode = 1;
    });
    stream.compose(spec).pipe(process.stdout);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    runInteractiveTests(process.argv.slice(2));
}
