import type { Progress } from '@modelcontextprotocol/client';
import { createGatewayCore, type RuntimeDependencies } from '../../src/application/plugin-runtime.ts';
import type { ControlContext, CoreControlHandler, CoreControlRequest } from '../../src/domains/control-contract.ts';
import type { ClientRequestFacilities } from '../../src/shared/client-context.ts';

/** Test composition over the real core, with one explicit authenticated client. */
export async function createCoreFixture(
    dependencies: RuntimeDependencies = {},
    facilities: Omit<Partial<ClientRequestFacilities>, 'requestId' | 'waitSignal'> = {},
) {
    const core = await createGatewayCore(dependencies);
    const registration = core.register();
    const client = core.attachClient(registration.bearer);
    let sequence = 0;
    function request(overrides: Partial<ClientRequestFacilities> = {}) {
        return client.request({
            requestId: ++sequence,
            capabilities: { roots: false, formElicitation: false },
            ...facilities,
            ...overrides,
        });
    }
    const context = (value: ControlContext = {}): ControlContext => ({
        ...value,
        client: request(value.signal ? { waitSignal: value.signal } : {}),
    });
    const controller: CoreControlHandler = {
        status: core.controller.status,
        start: (options, value) => core.controller.start(options, context(value)),
        restart: (route, value) => core.controller.restart(route, context(value)),
        stop: (route, value) => core.controller.stop(route, context(value)),
    };
    return {
        core,
        registration,
        client,
        request,
        controller,
        control: (value: CoreControlRequest, signal?: AbortSignal) =>
            core.control(value, request(signal ? { waitSignal: signal } : {})),
        invoke: (
            name: string,
            args: Record<string, unknown>,
            signal?: AbortSignal,
            onProgress?: (progress: Progress) => void,
        ) =>
            core.invoke(
                name,
                args,
                request({ ...(signal ? { waitSignal: signal } : {}), ...(onProgress ? { onProgress } : {}) }),
            ),
        cleanup: core.cleanup,
    };
}
