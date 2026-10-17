import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClientPrincipal } from '../shared/client-context.ts';

type Registration = {
    principal: ClientPrincipal;
    lastActivity: number;
    resources: Set<string>;
    jobs: number;
};

/** Bearer possession authenticates a memory-only principal; only creation returns the bearer. */
export function createRegistrationRegistry({
    now = Date.now,
    onExpire,
}: {
    now?: () => number;
    onExpire?: (principal: ClientPrincipal) => void;
} = {}) {
    const entries = new Map<string, Registration>();
    const bearers = new Map<string, string>();
    const resourceOwners = new Map<string, ClientPrincipal>();
    const digest = (bearer: string) => createHash('sha256').update(bearer).digest('hex');
    function remove(registration: Registration) {
        entries.delete(registration.principal.registrationId);
        for (const [key, id] of bearers) if (id === registration.principal.registrationId) bearers.delete(key);
        onExpire?.(registration.principal);
    }
    function check(principal: ClientPrincipal): Registration {
        const registration = entries.get(principal.registrationId);
        if (!registration || registration.principal !== principal)
            throw new Error('The registration is absent or expired.');
        if (!registration.resources.size && !registration.jobs && now() - registration.lastActivity >= 30 * 60 * 1000) {
            remove(registration);
            throw new Error('The registration is absent or expired.');
        }
        return registration;
    }
    function authorize(resource: string, principal: ClientPrincipal) {
        check(principal);
        if (resourceOwners.get(resource) !== principal) throw new Error('The connection is absent or unauthorized.');
    }
    function release(resource: string) {
        const owner = resourceOwners.get(resource);
        if (owner) entries.get(owner.registrationId)?.resources.delete(resource);
        resourceOwners.delete(resource);
    }
    return {
        create() {
            const principal = Object.freeze({ registrationId: randomUUID() });
            const bearer = randomBytes(32).toString('base64url');
            entries.set(principal.registrationId, { principal, lastActivity: now(), resources: new Set(), jobs: 0 });
            bearers.set(digest(bearer), principal.registrationId);
            return { principal, bearer };
        },
        authenticate(bearer: string) {
            const id = bearers.get(digest(bearer));
            const registration = id ? entries.get(id) : undefined;
            if (!registration) throw new Error('The registration is absent or expired.');
            check(registration.principal);
            return registration.principal;
        },
        check,
        resolve(registrationId: string) {
            const registration = entries.get(registrationId);
            if (!registration) throw new Error('The registration is absent or expired.');
            check(registration.principal);
            return registration.principal;
        },
        touch(principal: ClientPrincipal) {
            check(principal).lastActivity = now();
        },
        own(resource: string, principal: ClientPrincipal) {
            const registration = check(principal);
            if (resourceOwners.has(resource)) throw new Error('The connection already has an owner.');
            registration.resources.add(resource);
            resourceOwners.set(resource, principal);
        },
        authorize,
        release,
        transfer(resource: string, successor: ClientPrincipal, busy: () => boolean) {
            const registration = check(successor);
            if (!resourceOwners.has(resource)) throw new Error('The connection is absent.');
            if (busy()) throw new Error('The connection is busy and cannot transfer.');
            release(resource);
            registration.resources.add(resource);
            resourceOwners.set(resource, successor);
        },
        beginJob(principal: ClientPrincipal) {
            const registration = check(principal);
            registration.jobs += 1;
            let finished = false;
            return () => {
                if (!finished) {
                    finished = true;
                    registration.jobs -= 1;
                }
            };
        },
        unregister(principal: ClientPrincipal) {
            const registration = check(principal);
            if (registration.resources.size || registration.jobs)
                throw new Error('Registration still owns resources or jobs.');
            remove(registration);
        },
        list() {
            return [...entries.values()].map(({ principal, resources, jobs }) => ({
                registrationId: principal.registrationId,
                resources: resources.size,
                jobs,
            }));
        },
    };
}
