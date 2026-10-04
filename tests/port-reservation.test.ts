import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortReservations } from '../src/adapters/port-reservation.ts';

test('a synchronous port claim excludes another claimant while asynchronous readiness is pending', async () => {
    const reservations = createPortReservations();
    const release = reservations.claim(9222);
    assert.ok(release);
    let confirmReadiness: (() => void) | undefined;
    const readiness = new Promise<void>((resolve) => {
        confirmReadiness = resolve;
    });
    const pending = (async () => {
        await readiness;
        return release;
    })();

    assert.equal(reservations.claim(9222), undefined);
    assert.ok(confirmReadiness);
    confirmReadiness();
    (await pending)();

    const nextRelease = reservations.claim(9222);
    assert.ok(nextRelease);
    nextRelease();
});

test('releasing one port preserves claims on other ports', () => {
    const reservations = createPortReservations();
    const releaseFirst = reservations.claim(9222);
    const releaseSecond = reservations.claim(9223);
    assert.ok(releaseFirst);
    assert.ok(releaseSecond);

    releaseFirst();
    const nextRelease = reservations.claim(9222);
    assert.ok(nextRelease);
    assert.equal(reservations.claim(9223), undefined);

    nextRelease();
    releaseSecond();
});

test('repeated release from an old owner cannot release a newer port claim', () => {
    const reservations = createPortReservations();
    const oldRelease = reservations.claim(9222);
    assert.ok(oldRelease);
    oldRelease();

    const newRelease = reservations.claim(9222);
    assert.ok(newRelease);
    oldRelease();
    oldRelease();
    assert.equal(reservations.claim(9222), undefined);

    newRelease();
    const finalRelease = reservations.claim(9222);
    assert.ok(finalRelease);
    finalRelease();
});

test('independent gateway registries can claim the same port', () => {
    const first = createPortReservations();
    const second = createPortReservations();
    const releaseFirst = first.claim(9222);
    const releaseSecond = second.claim(9222);
    assert.ok(releaseFirst);
    assert.ok(releaseSecond);

    releaseFirst();
    assert.equal(second.claim(9222), undefined);
    releaseSecond();
});
