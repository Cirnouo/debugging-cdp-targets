import { fileURLToPath } from 'node:url';
import { requireGuiAuthorization } from '../gui-authorization.ts';
import { launchSealedStudy, verifySealedStudy } from './sealed-study.ts';

declare const __DCT_SEALED_STUDY__: boolean;

const args = ['--allow-gui', ...requireGuiAuthorization()];
if (typeof __DCT_SEALED_STUDY__ === 'undefined' || !__DCT_SEALED_STUDY__) {
    await launchSealedStudy('layers', args);
} else {
    const subject = await verifySealedStudy('layers', args, undefined, {
        entry: fileURLToPath(import.meta.url),
        nodeExecutable: process.execPath,
    });
    const { runScreenshotLayersStudy } = await import('./screenshot-layers-study.ts');
    await runScreenshotLayersStudy(subject.args, subject);
}
