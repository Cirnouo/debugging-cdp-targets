import { type ChangeEvent, type FormEvent, createElement as h, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type AppAppearance, parseAppConfiguration } from '../domains/app-configuration.ts';
import { type AppUiBridge, type AppUiSnapshot, parseAppUiSnapshot } from '../domains/app-ui.ts';

declare global {
    interface Window {
        dctApp: AppUiBridge;
    }
}

function Manager() {
    const [snapshot, setSnapshot] = useState<AppUiSnapshot>();
    const [port, setPort] = useState('');
    const [appearance, setAppearance] = useState<AppAppearance>('system');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const accept = useCallback((value: unknown) => {
        const next = parseAppUiSnapshot(value);
        setSnapshot(next);
        setPort(next.configuration ? String(next.configuration.desired.port) : '');
        setAppearance(next.configuration?.desired.appearance ?? 'system');
        document.documentElement.dataset.appearance = next.configuration?.effective.appearance ?? 'system';
    }, []);

    useEffect(() => {
        let available = true;
        window.dctApp
            .inspect()
            .then((value) => {
                if (available) accept(value);
            })
            .catch(() => {
                if (available)
                    setError('The management window could not read App state. Reopen the manager to try again.');
            });
        return () => {
            available = false;
        };
    }, [accept]);

    const run = async (action: () => Promise<unknown>, failure: string) => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const value = await action();
            if (value !== undefined) accept(value);
        } catch {
            setError(failure);
        } finally {
            setBusy(false);
        }
    };

    const save = (event: FormEvent) => {
        event.preventDefault();
        void run(
            () => window.dctApp.configure(parseAppConfiguration({ schemaVersion: 1, port: Number(port), appearance })),
            'Settings could not be saved. The previous configuration remains in effect.',
        );
    };
    const ready = snapshot?.phase === 'ready';
    const closing = snapshot?.phase === 'closing';
    const disabled = busy || !snapshot?.configuration || (snapshot.phase !== 'ready' && snapshot.phase !== 'failed');
    const effectivePort = snapshot?.configuration?.effective.port;

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
            { className: 'endpoint', 'aria-labelledby': 'endpoint-heading' },
            h('p', { className: 'eyebrow', id: 'endpoint-heading' }, 'MCP CONNECTION'),
            h(
                'p',
                { className: 'endpoint-url' },
                ready ? `http://127.0.0.1:${effectivePort}/mcp` : 'Endpoint unavailable',
            ),
            h(
                'p',
                { className: 'muted' },
                ready
                    ? 'Your host plugins connect directly to this App. Target connections stay owned by their registrations.'
                    : closing
                      ? 'Waiting for normal target and official Server cleanup.'
                      : 'The App will report its endpoint after startup succeeds.',
            ),
        ),
        snapshot?.message ? h('p', { className: 'notice', role: 'status' }, snapshot.message) : null,
        error ? h('p', { className: 'error', role: 'alert' }, error) : null,
        h(
            'section',
            { className: 'settings', 'aria-labelledby': 'settings-heading' },
            h(
                'div',
                { className: 'section-title' },
                h(
                    'div',
                    null,
                    h('h2', { id: 'settings-heading' }, 'App settings'),
                    h(
                        'p',
                        { className: 'muted' },
                        'Appearance applies immediately. A port change takes effect after a normal restart.',
                    ),
                ),
                h(
                    'button',
                    {
                        type: 'button',
                        className: 'secondary',
                        disabled: busy,
                        onClick: () => void run(() => window.dctApp.inspect(), 'App state could not be refreshed.'),
                    },
                    'Refresh',
                ),
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
                            disabled,
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
                                name: 'appearance',
                                value: appearance,
                                disabled,
                                onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                                    const value = event.currentTarget.value;
                                    if (value === 'system' || value === 'light' || value === 'dark')
                                        setAppearance(value);
                                },
                            },
                            h('option', { value: 'system' }, 'System'),
                            h('option', { value: 'light' }, 'Light'),
                            h('option', { value: 'dark' }, 'Dark'),
                        ),
                    ),
                ),
                h(
                    'div',
                    { className: 'form-footer' },
                    h(
                        'p',
                        { className: 'muted' },
                        effectivePort === undefined ? 'Waiting for configuration…' : `Effective port: ${effectivePort}`,
                    ),
                    h('button', { type: 'submit', disabled }, busy ? 'Working…' : 'Save settings'),
                ),
            ),
            snapshot?.configuration?.restartRequired
                ? h(
                      'div',
                      { className: 'restart-notice' },
                      h('p', null, 'The desired port is saved. Restart the App to bind the new endpoint.'),
                      h(
                          'button',
                          {
                              type: 'button',
                              disabled,
                              onClick: () =>
                                  void run(
                                      () => window.dctApp.restart(),
                                      'Normal cleanup did not finish. The App retains ownership; retry the restart.',
                                  ),
                          },
                          'Restart App',
                      ),
                  )
                : null,
        ),
        h(
            'footer',
            { className: 'app-footer' },
            h('p', { className: 'muted' }, 'Targets start through your host’s MCP tools.'),
            h(
                'button',
                {
                    type: 'button',
                    className: 'secondary',
                    disabled: busy,
                    onClick: () =>
                        void run(
                            () => window.dctApp.quit(),
                            'Normal cleanup did not finish. The App retains ownership; retry Quit.',
                        ),
                },
                closing ? 'Retry Quit' : 'Quit App',
            ),
        ),
    );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing App management root.');
createRoot(root).render(h(Manager));
