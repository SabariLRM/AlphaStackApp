import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

/** Live mailbox events. Browsers authenticate with the session cookie, the app with a Bearer token. */
export async function wsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    const auth = req.auth;
    if (!auth) {
      socket.close(4401, 'unauthorized');
      return;
    }
    if (auth.viaCookie) {
      // Cookie-authenticated sockets must come from our own origin (cross-site WebSocket hijacking).
      const origin = req.headers.origin;
      const host = req.headers['x-forwarded-host'] ?? req.headers.host;
      try {
        if (origin && new URL(origin).host !== host) {
          socket.close(4403, 'forbidden origin');
          return;
        }
      } catch {
        socket.close(4403, 'forbidden origin');
        return;
      }
    }
    ctx.realtime.add(auth.userId, socket);
    socket.send(JSON.stringify({ type: 'hello' }));
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    socket.on('message', (data) => {
      if (data.toString() === 'ping') socket.send('pong');
    });
    const timer = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 30_000);
    socket.on('close', () => clearInterval(timer));
  });
}
