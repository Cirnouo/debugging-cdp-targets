import { startPluginRuntime } from '../application/plugin-runtime.ts';
import { errorDetails, errorMessage } from '../shared/errors.ts';

try {
    const runtime = await startPluginRuntime();
    await runtime.closed;
} catch (error) {
    process.stderr.write(`debugging-cdp-targets: ${errorMessage(error)}\n`);
    const details = errorDetails(error);
    if (details) process.stderr.write(`${JSON.stringify(details)}\n`);
    process.exitCode = 1;
}
