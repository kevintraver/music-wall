// WebSocket Message Types
export interface WebSocketMessage {
  type: string;
  payload?: any;
  timestamp?: number;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  image: string;
  position: number;
}

export interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  image?: string;
  uri?: string;
}

export interface PlaybackState {
  nowPlaying: Track | null;
  isPlaying: boolean;
  queue: Track[];
}

// Message Types
export interface AlbumsUpdateMessage extends WebSocketMessage {
  type: 'albums';
  payload: Album[];
}

export interface PlaybackUpdateMessage extends WebSocketMessage {
  type: 'playback';
  payload: PlaybackState;
}

export interface QueueUpdateMessage extends WebSocketMessage {
  type: 'queue';
  payload: Track[];
}

export interface AuthMessage extends WebSocketMessage {
  type: 'auth';
  payload: {
    accessToken: string;
    refreshToken: string;
  };
}

export interface RefreshMessage extends WebSocketMessage {
  type: 'refresh';
}

export interface PingMessage extends WebSocketMessage {
  type: 'ping';
}

export interface PongMessage extends WebSocketMessage {
  type: 'pong';
}

export interface AdminStatsMessage extends WebSocketMessage {
  type: 'admin_stats';
  payload: {
    totalClients: number;
    adminClients: number;
    wallClients: number;
    lastActivity: string;
    uptime: number;
    serverStartTime: string;
  };
}

export type WSMessage =
  | AlbumsUpdateMessage
  | PlaybackUpdateMessage
  | QueueUpdateMessage
  | AuthMessage
  | RefreshMessage
  | PingMessage
  | PongMessage
  | AdminStatsMessage;

// Client Types
export interface WSClient {
  id: string;
  ws: any; // WebSocket from 'ws' package
  isAdmin: boolean;
  lastActivity: number;
}