# Connection resource lifetime

- `resource-owner.ts` exports createResourceOwner/ResourceOwner and OwnedResource.
    One owner retains a resource generation's acquisitions, abort/exit latch,
    close promises, disposal failures and retries. Internal sessionId remains
    distinct from public connection/session routing.
- `directory-lease.ts` exports createConnectionDirectoryLease/ConnectionDirectoryLease.
    It holds the adapter's DataDirectoryLease across generations, pending acquisition,
    successor holds, live apps and resource cleanup, publishing explicit evidence.
- `AGENTS.md` defines cumulative lifetime, capability and evidence constraints.

Core in application/plugin-runtime.ts creates/enrolls these owners and retains the
connection registry, generation fences, original actual-execution context and
cleanup/retry joins. target-controller.ts owns launch and actual-exit observation.
The data-directory adapter still owns filesystem claims/identity/whole-directory
cleanup. No compatibility facade or second authority is introduced here.
