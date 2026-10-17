import {
    type ChangeEvent,
    type FormEvent,
    createElement as h,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import {
    type AppAppearance,
    type AppConfiguration,
    type AppHostSelection,
    parseAppConfiguration,
} from '../domains/app-configuration.ts';
import {
    type AppConnectionSummary,
    type AppHostSummary,
    type AppManagementCommand,
    type AppUiBridge,
    type AppUiSnapshot,
    formatAppElapsed,
    parseAppUiSnapshot,
} from '../domains/app-ui.ts';
import type { RestartScope } from '../domains/control-contract.ts';
import type { PluginHost } from '../domains/host-management.ts';

type Panel = 'connections' | 'registrations' | 'operations' | 'hosts' | 'settings';
const PANELS: readonly Panel[] = ['connections', 'registrations', 'operations', 'hosts', 'settings'];
const HOSTS = ['codex', 'claude'] as const;
const emptyHosts = {
    codex: { configRoot: null, executable: null, pluginRoot: null },
    claude: { configRoot: null, executable: null, pluginRoot: null },
} as const;
const short = (id: string | undefined) => (id === undefined ? 'App' : id.slice(0, 8));
const terminal = (state: string) => ['succeeded', 'failed', 'cancelled'].includes(state);
const route = (connection: AppConnectionSummary) => {
    if (connection.sessionId === undefined) throw new Error('The connection has no current public session.');
    return { connectionId: connection.connectionId, sessionId: connection.sessionId };
};
const label = (value: string) => value.replaceAll('-', ' ');
const button = (text: string, action: () => void, disabled = false, className = 'secondary small') =>
    h('button', { type: 'button', className, disabled, onClick: action }, text);

function SelectedConfiguration({
    detail,
}: {
    detail: NonNullable<NonNullable<AppUiSnapshot['management']>['selected']>;
}) {
    const launch = detail.launch;
    const isolation = detail.isolation;
    const entries: [string, string][] = launch
        ? [
              ['Executable', launch.executable],
              ['Arguments', JSON.stringify(launch.arguments)],
              ['Working directory', launch.cwd ?? 'Default'],
              ['Environment overrides', launch.environmentNames.join(', ') || 'None'],
              ['Port policy', launch.portPolicy ?? 'Unavailable'],
          ]
        : [];
    if (isolation) {
        entries.push(['Isolation', isolation.mode]);
        if (isolation.mode === 'data-dir')
            entries.push(
                ['Directory', isolation.path],
                ['Directory cleanup', `${isolation.cleanup} · ${isolation.state}`],
            );
    }
    return h(
        'dl',
        { className: 'identity-grid selected-configuration' },
        entries.flatMap(([name, value]) => [h('dt', { key: `${name}-label` }, name), h('dd', { key: name }, value)]),
    );
}

function HostState({ summary }: { summary: AppHostSummary }) {
    return h(
        'div',
        { className: 'host-result' },
        h(
            'span',
            { className: `status ${summary.state === 'disk-synchronized' ? 'ready' : ''}` },
            label(summary.state),
        ),
        summary.reason ? h('p', { className: 'muted' }, label(summary.reason)) : null,
        summary.version ? h('p', null, `Plugin ${summary.version}`) : null,
        summary.activation === 'reload-pending'
            ? h(
                  'p',
                  { className: 'notice compact' },
                  'Saved on disk. Reload the host to activate; active sessions are unverified.',
              )
            : null,
        summary.candidate === 'no-candidate' || summary.state === 'no-candidate'
            ? h(
                  'p',
                  { className: 'muted' },
                  'No published stable update. Verified App-owned copies can still synchronize their URL.',
              )
            : null,
        summary.candidate === 'app-update-required' || summary.state === 'app-update-required'
            ? h('p', { className: 'notice compact' }, 'A newer App is required. The installed plugin is retained.')
            : null,
        summary.installations?.length === 0
            ? h('p', { className: 'muted' }, 'Plugin missing in this selection.')
            : null,
        summary.installations?.map((item, index) =>
            h(
                'p',
                { className: 'muted installation', key: `${item.scope}-${index}` },
                `${item.scope} · ${item.version} · ${item.enabled ? 'enabled' : 'disabled'} · ${item.pathResolved ? 'path verified' : 'path unresolved'}${item.readOnlyReason ? ` · ${label(item.readOnlyReason)} (read only)` : ''}`,
            ),
        ),
    );
}

export function AppManager({ bridge, initialSnapshot }: { bridge: AppUiBridge; initialSnapshot?: AppUiSnapshot }) {
    const [snapshot, setSnapshot] = useState<AppUiSnapshot | undefined>(initialSnapshot);
    const [panel, setPanel] = useState<Panel>('connections');
    const [now, setNow] = useState(Date.now);
    const [port, setPort] = useState(String(initialSnapshot?.configuration?.desired.port ?? ''));
    const [appearance, setAppearance] = useState<AppAppearance>(
        initialSnapshot?.configuration?.desired.appearance ?? 'system',
    );
    const [hostSettings, setHostSettings] = useState<AppConfiguration['hosts']>(
        initialSnapshot?.configuration?.desired.hosts ?? emptyHosts,
    );
    const [selection, setSelection] = useState<string[]>([]);
    const [destination, setDestination] = useState('');
    const [scope, setScope] = useState<RestartScope | ''>('');
    const [detail, setDetail] = useState<NonNullable<AppUiSnapshot['management']>['selected']>();
    const [outcomes, setOutcomes] = useState<NonNullable<AppUiSnapshot['management']>['outcomes']>();
    const [error, setError] = useState('');
    const [pending, setPending] = useState<string[]>([]);
    const work = useRef(new Set<string>());
    const mounted = useRef(true);
    const accept = useCallback((input: unknown) => {
        const value = parseAppUiSnapshot(input);
        if (!mounted.current) return;
        setSnapshot(value);
        document.documentElement.dataset.appearance = value.configuration?.effective.appearance ?? 'system';
        if (value.management?.outcomes) setOutcomes(value.management.outcomes);
        if (value.management?.selected) setDetail(value.management.selected);
    }, []);
    const desiredKey = snapshot?.configuration === undefined ? '' : JSON.stringify(snapshot.configuration.desired);
    useEffect(() => {
        if (!desiredKey) return;
        const configuration = parseAppConfiguration(JSON.parse(desiredKey));
        setPort(String(configuration.port));
        setAppearance(configuration.appearance);
        setHostSettings(configuration.hosts);
    }, [desiredKey]);
    useEffect(() => {
        mounted.current = true;
        let reading = false;
        const refresh = () => {
            if (reading) return;
            reading = true;
            void bridge
                .inspect()
                .then(accept)
                .catch(() => {
                    if (mounted.current) setError('App state could not be read. Use Refresh to retry.');
                })
                .finally(() => {
                    reading = false;
                });
        };
        refresh();
        const polling = setInterval(refresh, 2000);
        const clock = setInterval(() => setNow(Date.now()), 1000);
        return () => {
            mounted.current = false;
            clearInterval(polling);
            clearInterval(clock);
        };
    }, [bridge, accept]);
    const run = async (key: string, action: () => Promise<unknown>) => {
        if (work.current.has(key)) return;
        work.current.add(key);
        setPending([...work.current]);
        setError('');
        try {
            const value = await action();
            if (value !== undefined) accept(value);
        } catch {
            if (mounted.current) {
                setError(
                    'The action did not complete. Ownership is retained. Refresh the state and retry the affected row.',
                );
                void bridge
                    .inspect()
                    .then(accept)
                    .catch(() => {});
            }
        } finally {
            work.current.delete(key);
            if (mounted.current) setPending([...work.current]);
        }
    };
    const manage = (command: AppManagementCommand, key = 'management') => void run(key, () => bridge.manage(command));
    const closing = snapshot?.phase === 'closing';
    const ready = snapshot?.phase === 'ready';
    const available =
        snapshot?.configuration !== undefined && (snapshot.phase === 'ready' || snapshot.phase === 'failed');
    const data = snapshot?.management;
    const connections = data?.connections ?? [];
    const registrations = data?.registrations ?? [];
    const selected = connections.filter(
        (connection) => connection.sessionId !== undefined && selection.includes(connection.connectionId),
    );
    const chosen = selected.length === 1 ? selected[0] : undefined;
    const disabled = !ready || pending.includes('management');
    const shownDetail =
        detail && chosen?.connectionId === detail.connectionId && chosen.sessionId === detail.sessionId
            ? detail
            : undefined;
    const save = (event: FormEvent) => {
        event.preventDefault();
        void run('settings', () =>
            bridge.configure(
                parseAppConfiguration({ schemaVersion: 2, port: Number(port), appearance, hosts: hostSettings }),
            ),
        );
    };
    const selectOne = (connection: AppConnectionSummary) => {
        setSelection([connection.connectionId]);
        setScope('');
        manage({ kind: 'connection', route: route(connection) }, 'detail');
    };
    const changeHost = (host: PluginHost, key: keyof AppHostSelection, value: string) =>
        setHostSettings((current) => ({
            ...current,
            [host]: { ...current[host], [key]: value === '' ? null : value },
        }));
    const settingsButton = h(
        'button',
        { type: 'submit', disabled: !available || pending.includes('settings') },
        'Save settings',
    );

    let content: ReactNode;
    if (panel === 'connections')
        content = h(
            'section',
            { className: 'workspace', 'aria-label': 'Connections' },
            h(
                'div',
                { className: 'section-title' },
                h(
                    'div',
                    null,
                    h('h2', null, 'Owned connections'),
                    h(
                        'p',
                        { className: 'muted' },
                        'Age survives restart. Idle counts time since real work; these clocks do not contact targets.',
                    ),
                ),
                h('span', { className: 'count' }, connections.length),
            ),
            connections.length === 0
                ? h(
                      'div',
                      { className: 'empty' },
                      h('h3', null, 'No targets are connected'),
                      h(
                          'p',
                          { className: 'muted' },
                          'Start a target with your host’s MCP tools. Its registration and connection will appear here.',
                      ),
                  )
                : h(
                      'div',
                      { className: 'table-scroll' },
                      h(
                          'table',
                          null,
                          h(
                              'thead',
                              null,
                              h(
                                  'tr',
                                  null,
                                  ...['Select', 'Connection / owner', 'State', 'Age / idle', 'Actions'].map((name) =>
                                      h('th', { key: name, scope: 'col' }, name),
                                  ),
                              ),
                          ),
                          h(
                              'tbody',
                              null,
                              connections.map((connection) =>
                                  h(
                                      'tr',
                                      {
                                          key: connection.connectionId,
                                          className: selection.includes(connection.connectionId) ? 'selected' : '',
                                      },
                                      h(
                                          'td',
                                          null,
                                          h('input', {
                                              type: 'checkbox',
                                              'aria-label': `Select connection ${short(connection.connectionId)}`,
                                              checked: selection.includes(connection.connectionId),
                                              disabled: connection.sessionId === undefined,
                                              onChange: (event: ChangeEvent<HTMLInputElement>) => {
                                                  const checked = event.currentTarget.checked;
                                                  setSelection((current) =>
                                                      checked
                                                          ? [...current, connection.connectionId]
                                                          : current.filter((id) => id !== connection.connectionId),
                                                  );
                                              },
                                          }),
                                      ),
                                      h(
                                          'td',
                                          null,
                                          button(
                                              short(connection.connectionId),
                                              () => selectOne(connection),
                                              connection.sessionId === undefined,
                                              'text-button mono',
                                          ),
                                          h(
                                              'p',
                                              { className: 'muted mono' },
                                              `Owner ${short(connection.registrationId)}`,
                                          ),
                                      ),
                                      h(
                                          'td',
                                          null,
                                          h('span', { className: 'status' }, label(connection.status)),
                                          h(
                                              'p',
                                              { className: 'muted' },
                                              `Official ${connection.upstreamStatus ?? 'unavailable'}`,
                                          ),
                                      ),
                                      h(
                                          'td',
                                          { className: 'clock-cell' },
                                          h(
                                              'p',
                                              { className: 'mono' },
                                              formatAppElapsed(connection.establishedAt, now),
                                          ),
                                          h(
                                              'p',
                                              { className: 'muted mono' },
                                              formatAppElapsed(connection.lastRealOperationAt, now),
                                          ),
                                      ),
                                      h(
                                          'td',
                                          null,
                                          h(
                                              'div',
                                              { className: 'row-actions' },
                                              button(
                                                  'Close',
                                                  () => manage({ kind: 'close', routes: [route(connection)] }),
                                                  disabled || connection.sessionId === undefined,
                                              ),
                                              button(
                                                  'Transfer',
                                                  () =>
                                                      manage({
                                                          kind: 'transfer',
                                                          routes: [route(connection)],
                                                          registrationId: destination,
                                                      }),
                                                  disabled || !destination || connection.sessionId === undefined,
                                              ),
                                          ),
                                      ),
                                  ),
                              ),
                          ),
                      ),
                  ),
            h(
                'div',
                { className: 'batch-bar' },
                h('p', { className: 'muted' }, `${selected.length} selected`),
                h(
                    'label',
                    null,
                    'Transfer to registration',
                    h(
                        'select',
                        {
                            value: destination,
                            onChange: (event: ChangeEvent<HTMLSelectElement>) =>
                                setDestination(event.currentTarget.value),
                            disabled,
                        },
                        h('option', { value: '' }, 'Choose registration…'),
                        registrations.map((registration) =>
                            h(
                                'option',
                                { key: registration.registrationId, value: registration.registrationId },
                                short(registration.registrationId),
                            ),
                        ),
                    ),
                ),
                button(
                    'Transfer selected',
                    () => manage({ kind: 'transfer', routes: selected.map(route), registrationId: destination }),
                    disabled || selected.length === 0 || !destination,
                ),
                button(
                    'Close selected',
                    () => manage({ kind: 'close', routes: selected.map(route) }),
                    disabled || selected.length === 0,
                ),
            ),
            outcomes
                ? h(
                      'div',
                      { className: 'notice compact', role: 'status' },
                      outcomes.map((outcome) =>
                          h(
                              'p',
                              { key: outcome.connectionId },
                              `${short(outcome.connectionId)} · ${outcome.state}${outcome.reason ? ` (${outcome.reason})` : ''}${outcome.operationId ? ` · operation ${short(outcome.operationId)}` : ''}`,
                          ),
                      ),
                      h(
                          'p',
                          { className: 'muted' },
                          'Accepted Close requests continue in Operations. Failed rows retain their current owner.',
                      ),
                  )
                : null,
            chosen
                ? h(
                      'aside',
                      { className: 'connection-detail', 'aria-label': 'Selected connection' },
                      h('h3', null, `Connection ${short(chosen.connectionId)}`),
                      h(
                          'dl',
                          { className: 'identity-grid' },
                          ...[
                              ['Connection', chosen.connectionId],
                              ['Session', chosen.sessionId],
                              ['Registration', chosen.registrationId ?? 'App'],
                              ['Target generation', chosen.targetGeneration],
                              ['Official generation', chosen.officialGeneration],
                              [
                                  'Process / port',
                                  `${chosen.processId ?? 'Unavailable'} / ${chosen.port ?? 'Unavailable'}`,
                              ],
                          ].flatMap(([key, value]) => [h('dt', { key: `${key}-label` }, key), h('dd', { key }, value)]),
                      ),
                      shownDetail
                          ? h(
                                'p',
                                { className: 'muted' },
                                `Enabled tools: ${shownDetail.enabledTools.join(', ') || 'none'}. Official configuration: ${shownDetail.mcpArgs.join(' ') || 'defaults'}.`,
                            )
                          : h(
                                'p',
                                { className: 'muted' },
                                'Select the connection ID to read its current tool configuration.',
                            ),
                      shownDetail ? h(SelectedConfiguration, { detail: shownDetail }) : null,
                      h(
                          'p',
                          { className: 'muted' },
                          'Restart reuses the old successful launch and official configuration. Changing them requires Close and a new host start.',
                      ),
                      h(
                          'div',
                          { className: 'restart-controls' },
                          h(
                              'label',
                              null,
                              'Restart scope',
                              h(
                                  'select',
                                  {
                                      value: scope,
                                      disabled,
                                      onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                                          const value = event.currentTarget.value;
                                          if (
                                              value === '' ||
                                              value === 'target' ||
                                              value === 'official' ||
                                              value === 'both'
                                          )
                                              setScope(value);
                                      },
                                  },
                                  h('option', { value: '' }, 'Choose a scope…'),
                                  h('option', { value: 'target' }, 'Target only'),
                                  h('option', { value: 'official' }, 'Official Server only'),
                                  h('option', { value: 'both' }, 'Both'),
                              ),
                          ),
                          button(
                              'Restart connection',
                              () => {
                                  if (scope) manage({ kind: 'restart', route: route(chosen), scope });
                              },
                              disabled || !scope,
                              'primary',
                          ),
                      ),
                  )
                : null,
        );
    if (panel === 'registrations')
        content = h(
            'section',
            { className: 'workspace', 'aria-label': 'Registrations' },
            h('h2', null, 'Registrations'),
            h(
                'p',
                { className: 'muted' },
                'Bearer tokens are never shown. Transfer idle connections to recover ownership; remove registrations after their resources and jobs finish.',
            ),
            registrations.length === 0
                ? h('p', { className: 'empty muted' }, 'No registrations yet.')
                : h(
                      'div',
                      { className: 'registration-list' },
                      registrations.map((registration) =>
                          h(
                              'article',
                              { className: 'registration', key: registration.registrationId },
                              h(
                                  'div',
                                  null,
                                  h('p', { className: 'mono' }, registration.registrationId),
                                  h(
                                      'p',
                                      { className: 'muted' },
                                      `${registration.resources} resources · ${registration.jobs} active jobs`,
                                  ),
                              ),
                              button(
                                  'Unregister',
                                  () => manage({ kind: 'unregister', registrationId: registration.registrationId }),
                                  disabled || registration.resources !== 0 || registration.jobs !== 0,
                              ),
                          ),
                      ),
                  ),
        );
    if (panel === 'operations')
        content = h(
            'section',
            { className: 'workspace', 'aria-label': 'Operations' },
            h('h2', null, 'Lifecycle operations'),
            h(
                'p',
                { className: 'muted' },
                'The Core’s current operation registry. Cancel requests existing cleanup; it does not discard ownership.',
            ),
            !data?.operations.length
                ? h('p', { className: 'empty muted' }, 'No lifecycle operations.')
                : h(
                      'div',
                      { className: 'operation-list' },
                      data.operations.map((operation) =>
                          h(
                              'article',
                              { className: 'operation', key: operation.operationId },
                              h(
                                  'div',
                                  null,
                                  h(
                                      'p',
                                      null,
                                      `${operation.action ?? 'Operation'} · `,
                                      h('span', { className: 'mono' }, short(operation.operationId)),
                                  ),
                                  h(
                                      'p',
                                      { className: 'muted' },
                                      `${label(operation.state)} · ${operation.phase} · ${formatAppElapsed(0, operation.elapsedMs)}`,
                                  ),
                                  h(
                                      'p',
                                      { className: 'muted mono' },
                                      `Owner ${short(operation.registrationId)} · connection ${short(operation.connectionId)}`,
                                  ),
                              ),
                              h(
                                  'div',
                                  { className: 'row-actions' },
                                  button('Read status', () =>
                                      manage(
                                          { kind: 'operation-status', operationId: operation.operationId },
                                          `operation-${operation.operationId}`,
                                      ),
                                  ),
                                  button(
                                      'Wait for change',
                                      () =>
                                          manage(
                                              {
                                                  kind: 'operation-wait',
                                                  operationId: operation.operationId,
                                                  cursor: operation.cursor,
                                              },
                                              `operation-${operation.operationId}`,
                                          ),
                                      terminal(operation.state) ||
                                          pending.includes(`operation-${operation.operationId}`),
                                  ),
                                  button(
                                      'Cancel',
                                      () =>
                                          manage(
                                              { kind: 'operation-cancel', operationId: operation.operationId },
                                              `cancel-${operation.operationId}`,
                                          ),
                                      closing || terminal(operation.state) || operation.state === 'cancelling',
                                  ),
                              ),
                          ),
                      ),
                  ),
        );
    if (panel === 'hosts')
        content = h(
            'section',
            { className: 'workspace', 'aria-label': 'Host plugins' },
            h('h2', null, 'Host plugins'),
            h(
                'p',
                { className: 'muted' },
                'User-scope management through native CLIs. Project, local, pinned, disabled and unmanaged copies keep their restrictions. Host reload is separate from disk synchronization.',
            ),
            h(
                'form',
                { onSubmit: save },
                h(
                    'div',
                    { className: 'host-grid' },
                    HOSTS.map((host) => {
                        const summary = data?.hosts.find((item) => item.host === host) ?? {
                            host,
                            state: 'not-checked' as const,
                            activation: 'unverified' as const,
                        };
                        const hostBusy = summary.state === 'busy' || pending.includes(`host-${host}`);
                        const keys: (keyof AppHostSelection)[] =
                            host === 'claude'
                                ? ['configRoot', 'executable', 'pluginRoot']
                                : ['configRoot', 'executable'];
                        return h(
                            'article',
                            { className: 'host-card', key: host, 'aria-busy': hostBusy },
                            h(
                                'div',
                                { className: 'section-title' },
                                h('h3', null, host === 'codex' ? 'Codex' : 'Claude Code'),
                                h('span', { className: 'eyebrow' }, 'USER SCOPE'),
                            ),
                            h(HostState, { summary }),
                            h(
                                'div',
                                { className: 'row-actions' },
                                button(
                                    'Inspect host',
                                    () => manage({ kind: 'host-inspect', host }, `host-${host}`),
                                    !available || hostBusy,
                                ),
                                button(
                                    hostBusy ? 'Working…' : 'Sync / retry',
                                    () => manage({ kind: 'host-sync', host }, `host-${host}`),
                                    !ready || hostBusy,
                                    'small',
                                ),
                            ),
                            h(
                                'details',
                                { className: 'host-selection' },
                                h('summary', null, 'Host paths and executable'),
                                h(
                                    'p',
                                    { className: 'muted' },
                                    'Blank uses this App’s user environment. Select absolute paths when the desktop environment differs. Save before inspecting a changed selection.',
                                ),
                                keys.map((key) =>
                                    h(
                                        'label',
                                        { key },
                                        key === 'configRoot'
                                            ? 'Configuration root'
                                            : key === 'executable'
                                              ? 'Native CLI executable'
                                              : 'Plugin cache root',
                                        h('input', {
                                            type: 'text',
                                            value: hostSettings[host][key] ?? '',
                                            disabled: !available || hostBusy,
                                            placeholder: 'Use App user environment',
                                            onChange: (event: ChangeEvent<HTMLInputElement>) =>
                                                changeHost(host, key, event.currentTarget.value),
                                            autoComplete: 'off',
                                            spellCheck: false,
                                        }),
                                    ),
                                ),
                            ),
                        );
                    }),
                ),
                h(
                    'div',
                    { className: 'form-footer' },
                    h(
                        'p',
                        { className: 'muted' },
                        'A changed selection starts a new management boundary. Previous-root receipts are not adopted.',
                    ),
                    settingsButton,
                ),
            ),
        );
    if (panel === 'settings')
        content = h(
            'section',
            { className: 'workspace settings', 'aria-label': 'App settings' },
            h('h2', null, 'App settings'),
            h(
                'p',
                { className: 'muted' },
                'Appearance applies immediately. Port changes require normal cleanup, App restart and a successful new bind.',
            ),
            h(
                'form',
                { onSubmit: save },
                h(
                    'div',
                    { className: 'fields' },
                    h(
                        'label',
                        null,
                        'Desired port',
                        h('input', {
                            name: 'port',
                            type: 'number',
                            min: 1024,
                            max: 65535,
                            required: true,
                            value: port,
                            disabled: !available,
                            onChange: (event: ChangeEvent<HTMLInputElement>) => setPort(event.currentTarget.value),
                        }),
                    ),
                    h(
                        'label',
                        null,
                        'Appearance',
                        h(
                            'select',
                            {
                                value: appearance,
                                disabled: !available,
                                onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                                    const value = event.currentTarget.value;
                                    if (value === 'system' || value === 'light' || value === 'dark')
                                        setAppearance(value);
                                },
                            },
                            ...(['system', 'light', 'dark'] as const).map((value) =>
                                h('option', { key: value, value }, label(value)),
                            ),
                        ),
                    ),
                ),
                h(
                    'div',
                    { className: 'form-footer' },
                    h(
                        'p',
                        { className: 'muted' },
                        ready
                            ? `Effective bound port: ${snapshot.configuration?.effective.port}`
                            : 'No effective endpoint is bound.',
                    ),
                    settingsButton,
                ),
            ),
            snapshot?.configuration && (snapshot.configuration.restartRequired || snapshot.phase === 'failed')
                ? h(
                      'div',
                      { className: 'restart-notice' },
                      h(
                          'p',
                          null,
                          `Desired port ${snapshot.configuration.desired.port} is saved. Restart to bind it, then synchronize each host independently.`,
                      ),
                      button(
                          'Restart App',
                          () => void run('exit', () => bridge.restart()),
                          !available || pending.includes('exit'),
                          'primary',
                      ),
                  )
                : null,
        );

    return h(
        'main',
        { className: 'manager' },
        h(
            'header',
            { className: 'masthead' },
            h(
                'div',
                { className: 'brand' },
                h('img', { src: '/icon.png', alt: '', width: 42, height: 42 }),
                h(
                    'div',
                    null,
                    h('p', { className: 'eyebrow' }, 'LOCAL DESKTOP GATEWAY'),
                    h('h1', null, 'Debugging CDP Targets'),
                ),
            ),
            h('span', { className: `status ${ready ? 'ready' : ''}`, role: 'status' }, snapshot?.phase ?? 'starting'),
        ),
        h(
            'section',
            { className: 'endpoint', 'aria-label': 'MCP endpoint' },
            h(
                'div',
                null,
                h('p', { className: 'eyebrow' }, 'MCP CONNECTION'),
                h(
                    'p',
                    { className: 'endpoint-url' },
                    ready ? `http://127.0.0.1:${snapshot.configuration?.effective.port}/mcp` : 'Endpoint unavailable',
                ),
                h(
                    'p',
                    { className: 'muted' },
                    closing
                        ? 'Closing admission. Owned targets and native host work must settle before exit.'
                        : 'Targets start through your host’s MCP tools. This manager keeps ownership visible.',
                ),
            ),
            h(
                'div',
                { className: 'totals' },
                h('strong', null, String(connections.length)),
                h('span', null, 'connections'),
                h('small', null, `${registrations.length} registrations`),
            ),
        ),
        snapshot?.message ? h('p', { className: 'notice', role: 'status' }, snapshot.message) : null,
        error ? h('p', { className: 'error', role: 'alert' }, error) : null,
        h(
            'nav',
            { className: 'tabs', 'aria-label': 'Management views' },
            PANELS.map((name) =>
                h(
                    'button',
                    {
                        type: 'button',
                        key: name,
                        className: panel === name ? 'tab active' : 'tab',
                        'aria-current': panel === name ? 'page' : undefined,
                        onClick: () => setPanel(name),
                    },
                    label(name),
                ),
            ),
            button(
                'Refresh',
                () => void run('refresh', () => bridge.inspect()),
                pending.includes('refresh'),
                'refresh secondary',
            ),
        ),
        content,
        h(
            'footer',
            { className: 'app-footer' },
            h('p', { className: 'muted' }, 'Memory-only connections · normal cleanup · local control'),
            button(
                closing ? (snapshot.exitIntent === 'restart' ? 'Retry restart' : 'Retry Quit') : 'Quit App',
                () =>
                    void run('exit', () =>
                        closing && snapshot.exitIntent === 'restart' ? bridge.restart() : bridge.quit(),
                    ),
                pending.includes('exit'),
                'secondary',
            ),
        ),
    );
}
