# Connection resource lifetime and workspace policy

- `resource-owner.ts` exports createResourceOwner/ResourceOwner and OwnedResource.
    One owner retains a resource generation's acquisitions, abort/exit latch,
    close promises, disposal failures and retries. Internal sessionId remains
    distinct from public connection/session routing.
- `directory-lease.ts` exports createConnectionDirectoryLease/ConnectionDirectoryLease.
    It holds the adapter's DataDirectoryLease across generations, pending acquisition,
    successor holds, live apps and resource cleanup, publishing explicit evidence.
- `workspace-policy.ts` exports describeWorkspacePolicy: a pure description of
    supplied official workspace arguments, negotiated-roots support and the required
    temporary-directory snapshot. It has no ambient default or connection authority.
- `AGENTS.md` defines cumulative lifetime, capability and evidence constraints.

Core in gateway/core.ts creates the lifetime owners and retains generation fences and
original actual-execution context. gateway/registry.ts enrolls them and owns route
membership and retained cleanup/retry joins. target-controller.ts owns launch and actual-exit observation.
Core captures the temporary directory before awaiting roots and supplies it to
the pure workspace calculation at the original managed-connection construction point.
The data-directory adapter still owns filesystem claims/identity/whole-directory
cleanup. No compatibility facade or second authority is introduced here.
