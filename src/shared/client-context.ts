import type { ElicitRequestFormParams, ElicitResult, ListRootsResult, Progress } from '@modelcontextprotocol/client';

export interface ClientPrincipal {
    readonly registrationId: string;
}

export interface ClientRequestFacilities {
    requestId: string | number;
    capabilities: { roots: boolean; formElicitation: boolean };
    readRoots?: () => Promise<ListRootsResult>;
    elicit?: (params: ElicitRequestFormParams, signal?: AbortSignal) => Promise<ElicitResult>;
    onProgress?: (progress: Progress) => void;
    waitSignal?: AbortSignal;
}

export interface ClientRequestContext {
    readonly principal: ClientPrincipal;
    readonly requestId: string | number;
    readonly capabilities: Readonly<ClientRequestFacilities['capabilities']>;
    readonly waitSignal: AbortSignal;
    available(): boolean;
    readRoots(): Promise<ListRootsResult>;
    elicit(params: ElicitRequestFormParams, signal?: AbortSignal): Promise<ElicitResult>;
    progress(progress: Progress): void;
}
