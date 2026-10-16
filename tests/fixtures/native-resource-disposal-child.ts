import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { waitForResourceFile } from './native-resource-cleanup.ts';

const directory = process.argv[2];
if (!directory) throw new Error('Missing owned disposal fixture directory.');
process.send?.({ ready: true });
await waitForResourceFile(directory, 'pipe-closed');
await writeFile(path.join(directory, 'creator-exited'), '0');
process.disconnect?.();
