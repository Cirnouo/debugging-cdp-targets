import { startPluginRuntime } from '../application/plugin-runtime.mjs';

try {
    const runtime = await startPluginRuntime();
    await runtime.closed;
} catch (error) {
    process.stderr.write(`debugging-cdp-targets: ${error.message}\n`);
    if (error.details) process.stderr.write(`${JSON.stringify(error.details)}\n`);
    process.exitCode = 1;
}
