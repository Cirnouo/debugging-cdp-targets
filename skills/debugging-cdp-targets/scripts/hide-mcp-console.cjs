'use strict';

const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const path = require('node:path');

function normalizeSpawnOptions(command, arguments_, options) {
    if (!Array.isArray(arguments_) || !options || typeof options !== 'object') return options;
    const commandName = path.basename(String(command)).toLowerCase();
    const isChromeDevtoolsCommandShell =
        (commandName === 'cmd.exe' || commandName === 'cmd') &&
        arguments_.some((argument) => /(?:^|[\\/\s"])(?:chrome-devtools)(?:\.cmd)?(?=$|[\s"])/i.test(String(argument)));
    if (isChromeDevtoolsCommandShell && options.windowsHide !== true) {
        return { ...options, windowsHide: true };
    }

    const entryPoint = arguments_.find((argument) => /(?:^|[\\/])chrome-devtools-mcp\.js$/i.test(String(argument)));
    const isViaCliServer =
        (commandName === 'node.exe' || commandName === 'node') && entryPoint && arguments_.includes('--viaCli');
    if (!isViaCliServer || options.windowsHide !== true || !Array.isArray(options.stdio)) return options;

    const stdio = [...options.stdio];
    if (stdio[2] !== 'inherit') return options;
    stdio[2] = 'ignore';
    return { ...options, stdio };
}

const patchKey = Symbol.for('debugging-cdp-targets.hidden-console-patch');
if (!childProcess[patchKey]) {
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = function patchedSpawn(command, arguments_, options) {
        return originalSpawn.call(this, command, arguments_, normalizeSpawnOptions(command, arguments_, options));
    };
    Object.defineProperty(childProcess, patchKey, { value: true });
    syncBuiltinESMExports();
}

module.exports = { normalizeSpawnOptions };
