export const APP_UI_URL = 'dct-app://manager/';

const APP_ASSET_PATHS = ['/', '/app-renderer.js', '/app.css', '/icon.png'] as const;

export function appAssetPath(input: string, method: string, initiatorOrigin: unknown) {
    try {
        const url = new URL(input);
        if (
            method !== 'GET' ||
            url.protocol !== 'dct-app:' ||
            url.host !== 'manager' ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            (initiatorOrigin !== undefined && initiatorOrigin !== 'dct-app://manager')
        )
            return undefined;
        return APP_ASSET_PATHS.find((candidate) => candidate === url.pathname);
    } catch {
        return undefined;
    }
}
