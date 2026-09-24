import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Keeps queries fresh by listening to the API's WebSocket and invalidating on mailbox events. */
export function useRealtime(enabled: boolean, onNewMail?: (entryId: string) => void) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let retry = 0;
    let timer: number | undefined;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/api/ws`);
      socket.onopen = () => {
        retry = 0;
      };
      socket.onmessage = (ev) => {
        let msg: { type: string; entryId?: string; folder?: string; direction?: string };
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (msg.type === 'hello') return;
        if (msg.type === 'profile.updated') {
          void qc.invalidateQueries({ queryKey: ['me'] });
          return;
        }
        if (msg.type === 'drafts.updated') {
          void qc.invalidateQueries({ queryKey: ['drafts'] });
          void qc.invalidateQueries({ queryKey: ['counts'] });
          return;
        }
        void qc.invalidateQueries({ queryKey: ['messages'] });
        void qc.invalidateQueries({ queryKey: ['counts'] });
        void qc.invalidateQueries({ queryKey: ['message'] });
        if (msg.type === 'entry.created' && msg.direction === 'in' && msg.folder === 'inbox' && msg.entryId) onNewMail?.(msg.entryId);
      };
      socket.onclose = () => {
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        timer = window.setTimeout(connect, 1000 * 2 ** retry);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, [enabled, qc, onNewMail]);
}
