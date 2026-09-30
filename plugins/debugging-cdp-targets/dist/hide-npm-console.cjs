'use strict';

// Preloaded only in the short-lived npx acquisition process, never the Server.
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');

function hiddenOptions(options) {
    return { ...options, windowsHide: true };
}

if (process.platform === 'win32') {
    const original = childProcess.spawn;
    childProcess.spawn = function hiddenSpawn(command, arguments_, options) {
        return original.call(this, command, arguments_, hiddenOptions(options));
    };
    syncBuiltinESMExports();
}

module.exports = { hiddenOptions };
