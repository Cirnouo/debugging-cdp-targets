#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { main, outputJson } from './interface/presentation.mjs';
import { SessionError } from './shared/errors.mjs';

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
    main(process.argv.slice(2)).catch((error) => {
        const sessionError = error instanceof SessionError
            ? error
            : new SessionError('UNEXPECTED_ERROR', error?.message || String(error));
        outputJson({ ok: false, errorCode: sessionError.code, message: sessionError.message, ...(sessionError.details === undefined ? {} : { details: sessionError.details }) });
        process.exitCode = 1;
    });
}
