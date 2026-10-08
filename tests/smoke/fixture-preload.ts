import { subscribeFixtureDiagnostics } from '../../src/adapters/fixture-diagnostics.ts';
import { createFixtureArtifacts } from './fixture-artifacts.ts';

// Query configuration belongs only to this owned Node child; it is never inherited by Chrome/upstream.
try {
    const query = new URL(import.meta.url).searchParams;
    const directory = query.get('directory');
    const fixture = query.get('fixture');
    if (directory && (fixture === 'official-server' || fixture === 'entry-recovery')) {
        const collector = createFixtureArtifacts(directory, fixture, {
            streamOnly: true,
            collectionId: query.get('collectionId'),
        });
        subscribeFixtureDiagnostics(
            (event) => collector.gateway(event),
            () => collector.rejected(),
        );
        process.once('exit', () => collector.finishStream());
    }
} catch {
    console.error('Fixture diagnostic preload unavailable (safe initialization failure).');
}
