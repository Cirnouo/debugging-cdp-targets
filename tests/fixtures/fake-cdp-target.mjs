import http from 'node:http';

const argument = process.argv.find((value) => value.startsWith('--remote-debugging-port='));
const port = Number(argument?.split('=')[1]);
if (!Number.isInteger(port)) throw new Error('A CDP port is required.');

http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/json/version') {
        response.end(
            JSON.stringify({
                Browser: 'Chrome/153.0.0.0',
                webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fixture`,
            }),
        );
        return;
    }
    response.end('[]');
}).listen(port, '127.0.0.1');
