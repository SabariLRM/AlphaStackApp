import type { WebSocket } from 'ws';

export type RealtimeEvent =
  | { type: 'entry.created'; entryId: string; conversationId: string; folder: string; direction: 'in' | 'out' }
  | { type: 'entries.updated'; entryIds: string[]; conversationIds: string[] }
  | { type: 'conversation.updated'; conversationId: string }
  | { type: 'drafts.updated' }
  | { type: 'profile.updated' };

/** In-process fan-out of mailbox events to a user's open WebSocket connections. */
export class RealtimeHub {
  private readonly sockets = new Map<string, Set<WebSocket>>();

  add(userId: string, socket: WebSocket): void {
    let set = this.sockets.get(userId);
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    set.add(socket);
    socket.on('close', () => {
      set.delete(socket);
      if (set.size === 0 && this.sockets.get(userId) === set) this.sockets.delete(userId);
    });
  }

  publish(userId: string, event: RealtimeEvent): void {
    const set = this.sockets.get(userId);
    if (!set) return;
    const payload = JSON.stringify(event);
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  connectionCount(userId: string): number {
    return this.sockets.get(userId)?.size ?? 0;
  }

  closeAll(): void {
    for (const set of this.sockets.values()) for (const socket of set) socket.close(1001, 'server shutting down');
    this.sockets.clear();
  }
}
