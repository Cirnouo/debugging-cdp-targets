import type { TargetKind } from '../../../domains/control-contract.ts';
import { DetailedError } from '../../../shared/errors.ts';
import type { LaunchDefinition } from './launch-command.ts';

export interface ListenerEvidence {
    localAddress: string;
    owningProcess: number;
}
export interface ProcessTarget {
    processId: number;
    port: number;
    executablePath: string;
    startedAtUtc: string;
    targetKind: TargetKind;
}
export type RootEvidence =
    | { exists: false }
    | {
          exists: true;
          executablePath: string;
          sessionId: number;
          startedAtUtc: string;
          productName?: string;
          companyName?: string;
      };
export interface ProcessEvidence {
    root: RootEvidence;
    currentSessionId: number;
    processIds: number[];
    listeners: ListenerEvidence[];
}
export interface ManagedTarget extends ProcessTarget {
    /** Resolves only from the actual application exit observation. */
    waitForExit?: (signal?: AbortSignal) => Promise<void>;
    launchDefinition?: LaunchDefinition;
    browserProduct?: string;
    webSocketDebuggerUrl?: string;
    verify?: () => Promise<void>;
    releaseProfile?: () => void;
    child?: {
        exitCode?: number | null;
        signalCode?: string | null;
        monitoringFailure?: string;
        onMonitorError?(listener: () => void): () => void;
        disposeMonitor?(): void;
        /** Resolves only when the native application resource group is verified empty. */
        waitForResourcesClosed?(): Promise<void>;
        ref?(): void;
        unref?(): void;
        once(event: 'exit', listener: () => void): unknown;
        off?(event: 'exit', listener: () => void): unknown;
    };
}

/** Internal ownership evidence for a new process whose normal rollback failed. */
export class RetainedTargetError extends DetailedError {
    readonly target: ManagedTarget;

    constructor(message: string, target: ManagedTarget) {
        super(message);
        this.target = target;
        Object.defineProperty(this, 'target', { enumerable: false });
    }
}
