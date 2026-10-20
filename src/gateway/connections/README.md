# Connection resource lifetime and workspace policy

- `managed-connection.ts` exports synchronous createManagedConnections and the
    original ManagedConnection/RuntimeRouter types. It owns connection state,
    generations, handler/lifecycle, restart, actual invoke, authorization and transfer.
    Core composes the
    registration/registry/catalog and supplies a live synchronous catalog reader.
- `start-admission.ts` exports createStartAdmission: the whole start transaction,
    persistent callbacks, rollback and final directory retry. It receives the same
    lifecycle at invocation and preserves original capture/acquisition order.
- `connection-view.ts` exports createConnectionView: live status, selected
    configuration, guarded post-control catalog projection and admin inventory.
    Unselected discovery retains current adapter defaults at its original branch.
    Both factories execute no providers at construction and retain no cache.
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

Start admission creates the lifetime owners; the managed connection retains generation fences and
original actual-execution context. gateway/registry.ts enrolls them and owns route
membership and retained cleanup/retry joins. target-controller.ts owns launch and actual-exit observation.
Start admission captures the temporary directory before awaiting roots and supplies it to
the pure workspace calculation at the original managed-connection construction point.
The data-directory adapter still owns filesystem claims/identity/whole-directory
cleanup. No compatibility facade or second authority is introduced here.
