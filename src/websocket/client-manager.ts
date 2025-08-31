import WebSocket from 'ws';
import { WSClient, WSMessage } from './types';

export class WebSocketClientManager {
  private clients: Map<string, WSClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  addClient(ws: WebSocket, isAdmin: boolean = false): string {
    const clientId = this.generateClientId();
    const client: WSClient = {
      id: clientId,
      ws,
      isAdmin,
      lastActivity: Date.now()
    };

    this.clients.set(clientId, client);

    ws.on('close', () => {
      this.clients.delete(clientId);
    });

    ws.on('message', () => {
      client.lastActivity = Date.now();
    });

    return clientId;
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  getClient(clientId: string): WSClient | undefined {
    return this.clients.get(clientId);
  }

  getAllClients(): WSClient[] {
    return Array.from(this.clients.values());
  }

  getAdminClients(): WSClient[] {
    return this.getAllClients().filter(client => client.isAdmin);
  }

  getWallClients(): WSClient[] {
    return this.getAllClients().filter(client => !client.isAdmin);
  }

  broadcast(message: WSMessage, filter?: (client: WSClient) => boolean): void {
    const clientsToSend = filter ? this.getAllClients().filter(filter) : this.getAllClients();
    console.log(`📡 Broadcasting ${message.type} to ${clientsToSend.length} clients`);

    clientsToSend.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN) {
        console.log(`📡 Sending ${message.type} to client ${client.id}`);
        client.ws.send(JSON.stringify(message));
      } else {
        console.log(`📡 Client ${client.id} not ready (state: ${client.ws.readyState})`);
      }
    });
  }

  broadcastToAdmins(message: WSMessage): void {
    this.broadcast(message, client => client.isAdmin);
  }

  broadcastToWall(message: WSMessage): void {
    this.broadcast(message, client => !client.isAdmin);
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = 5 * 60 * 1000; // 5 minutes

      for (const [clientId, client] of this.clients) {
        if (now - client.lastActivity > timeout) {
          console.log(`Removing inactive client: ${clientId}`);
          client.ws.close();
          this.clients.delete(clientId);
        }
      }
    }, 60000); // Check every minute
  }

  cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.clients.forEach(client => {
      client.ws.close();
    });

    this.clients.clear();
  }
}