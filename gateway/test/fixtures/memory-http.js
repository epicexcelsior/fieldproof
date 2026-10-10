// Exercise the real Express handlers without opening a socket or contacting a network.
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';

export function memoryFetch(app, origin) {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin) throw new Error('The test transport only serves its configured gateway');
    const body = init.body !== undefined ? Buffer.from(init.body) :
      input instanceof Request && input.body ? Buffer.from(await input.arrayBuffer()) : Buffer.alloc(0);
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    if (body.length) headers.set('content-length', String(body.length));
    headers.set('host', url.host);
    return new Promise((resolve, reject) => {
      const chunks = [];
      const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
      socket.remoteAddress = '127.0.0.1';
      const request = new IncomingMessage(socket);
      request.url = url.pathname + url.search;
      request.method = init.method ?? (input instanceof Request ? input.method : 'GET');
      request.headers = Object.fromEntries(headers);
      const response = new ServerResponse(request);
      response.assignSocket(socket);
      response.on('error', reject);
      response.on('finish', () => {
        try {
          const raw = Buffer.concat(chunks);
          const offset = raw.indexOf('\r\n\r\n');
          const lines = raw.subarray(0, offset).toString('utf8').split('\r\n');
          const status = Number(lines.shift().split(' ')[1]);
          const responseHeaders = new Headers(lines.map(line => {
            const colon = line.indexOf(':');
            return [line.slice(0, colon), line.slice(colon + 1).trim()];
          }));
          // Express JSON responses set Content-Length. Do not mask a changed response contract.
          if (responseHeaders.get('transfer-encoding') === 'chunked') throw new Error('Test transport requires a bounded JSON response');
          resolve(new Response(raw.subarray(offset + 4), { status, headers: responseHeaders }));
        } catch (error) { reject(error); }
        finally { socket.destroy(); }
      });
      app.handle(request, response, reject);
      if (body.length) request.push(body);
      request.push(null);
    });
  };
}
