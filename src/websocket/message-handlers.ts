import { WSMessage, WSClient, Album, Track, PlaybackState } from './types';
import { WebSocketClientManager } from './client-manager';

export class WebSocketMessageHandler {
  constructor(private clientManager: WebSocketClientManager) {}

  handleMessage(message: WSMessage, client: WSClient): void {
    console.log(`📨 WS message from ${client.isAdmin ? 'admin' : 'wall'} client:`, message.type);

    switch (message.type) {
      case 'auth':
        this.handleAuth(message, client);
        break;
      case 'refresh':
        this.handleRefresh(client);
        break;
      case 'ping':
        this.handlePing(client);
        break;
      default:
        console.warn(`Unknown message type: ${message.type}`);
    }
  }

  private handleAuth(message: WSMessage, client: WSClient): void {
    // Update client auth status
    client.isAdmin = true;
    console.log(`🔑 Client ${client.id} authenticated as admin`);
  }

  private handleRefresh(client: WSClient): void {
    console.log(`🛰️  Refresh requested by client ${client.id}`);
    // This will trigger a fresh data broadcast
  }

  private handlePing(client: WSClient): void {
    // Send pong response
    if (client.ws.readyState === 1) { // OPEN
      client.ws.send(JSON.stringify({ type: 'pong' }));
    }
  }

  // Broadcast methods
  broadcastAlbums(albums: Album[]): void {
    const message: WSMessage = {
      type: 'albums',
      payload: albums,
      timestamp: Date.now()
    };
    this.clientManager.broadcast(message);
  }

  broadcastPlaybackUpdate(playbackState: PlaybackState): void {
    const message: WSMessage = {
      type: 'playback',
      payload: playbackState,
      timestamp: Date.now()
    };
    this.clientManager.broadcast(message);
  }

  broadcastQueueUpdate(queue: Track[]): void {
    const message: WSMessage = {
      type: 'queue',
      payload: queue,
      timestamp: Date.now()
    };
    this.clientManager.broadcast(message);
  }

  // Admin-specific broadcasts
  broadcastToAdmins(message: WSMessage): void {
    this.clientManager.broadcastToAdmins(message);
  }

  // Wall-specific broadcasts
  broadcastToWall(message: WSMessage): void {
    this.clientManager.broadcastToWall(message);
  }
}