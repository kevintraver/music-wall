// Resolve the WebSocket endpoint. Falls back to localhost:3002 for dev.
export function getWebSocketUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_WS_URL || '').trim();
  if (configured) {
    return configured;
  }

  if (typeof window === 'undefined') {
    throw new Error('WebSocket URL requested on the server without NEXT_PUBLIC_WS_URL set');
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const port = (process.env.NEXT_PUBLIC_WS_PORT || '3002').trim();
  const host = window.location.hostname;

  return `${protocol}://${host}:${port}`;
}
