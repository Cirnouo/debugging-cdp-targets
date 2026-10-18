import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppUiBridge } from '../domains/app-ui.ts';
import { AppManager } from './app-manager.ts';

declare global {
    interface Window {
        dctApp: AppUiBridge;
    }
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing App management root.');
createRoot(root).render(h(AppManager, { bridge: window.dctApp }));
