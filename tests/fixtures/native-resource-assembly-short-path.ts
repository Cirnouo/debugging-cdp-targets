import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNativeResourceAssembly } from './native-resource-assembly.ts';

let compilerStarts = 0;
const owner = createNativeResourceAssembly({
    compile(args, settings, callback) {
        const output = args.at(-1) ?? '';
        assert.equal(
            path.dirname(output),
            realpathSync.native(path.dirname(output)),
            'the compiler must receive the real owned directory rather than its TEMP 8.3 alias',
        );
        compilerStarts++;
        return execFile('powershell.exe', args, settings, callback);
    },
});
try {
    const assembly = await owner.run((scope) => {
        assert.equal(scope.nativeAssembly, realpathSync.native(scope.nativeAssembly));
        assert.match(scope.nativeAssembly, /中文 \[owned\]/);
        return scope.nativeAssembly;
    });
    await owner.dispose();
    await assert.rejects(access(path.dirname(assembly)), { code: 'ENOENT' });
    console.log(JSON.stringify({ compilerStarts, assembly, cleaned: true }));
} catch (error) {
    await owner.dispose();
    const retained = owner.retainedDirectory;
    console.error(error);
    console.log(JSON.stringify({ compilerStarts, retained, cleaned: compilerStarts === 0 }));
    // A path assertion before execFile proves that no compiler/output writer was created.
    // Other preparation failures retain their directory because close alone is insufficient.
    if (compilerStarts === 0 && retained) {
        assert.equal(path.dirname(path.resolve(retained)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(retained).startsWith('dct-native-assembly-'));
        await rm(retained, { recursive: true, force: true });
    }
    process.exitCode = 1;
}
