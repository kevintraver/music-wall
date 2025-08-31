import WebSocket, { WebSocketServer } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from '@/lib/utils/env';
import { WebSocketClientManager } from './client-manager';
import { WebSocketMessageHandler } from './message-handlers';
import { WSMessage, Album, Track, PlaybackState } from './types';

// Declare global type for WebSocket update function
declare global {
  var sendWebSocketUpdate: (data: any) => void;
  var setSpotifyTokens: (tokens: { accessToken?: string; refreshToken?: string }) => void;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const ALBUMS_FILE = path.join(DATA_DIR, 'albums.json');

// OAuth variables
let accessToken = '';
let refreshToken = '';

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
  redirectUri: SPOTIFY_REDIRECT_URI,
});

// No file-based token persistence; tokens are provided by clients
console.log('🔑 WS tokens: using in-memory tokens only (no file persistence)');

// Admin monitoring data
let adminStats = {
  totalClients: 0,
  adminClients: 0,
  wallClients: 0,
  lastActivity: new Date().toISOString(),
  uptime: Date.now(),
  serverStartTime: new Date().toISOString()
};

function updateAdminStats(clientManager: WebSocketClientManager) {
  adminStats.totalClients = clientManager.getAllClients().length;
  adminStats.adminClients = clientManager.getAdminClients().length;
  adminStats.wallClients = clientManager.getWallClients().length;
  adminStats.lastActivity = new Date().toISOString();

  // Broadcast admin stats to all admin clients
  const adminStatsMessage: WSMessage = {
    type: 'admin_stats',
    payload: adminStats,
    timestamp: Date.now()
  };
  clientManager.broadcastToAdmins(adminStatsMessage);
}

// WebSocket server
const WS_PORT = process.env.WS_PORT ? Number(process.env.WS_PORT) : 3002;

export function startWebSocketServer() {
  const wss = new WebSocketServer({ port: WS_PORT });
  const clientManager = new WebSocketClientManager();
  const messageHandler = new WebSocketMessageHandler(clientManager);

  console.log('WebSocket server listening on port', WS_PORT);

  // Also start an HTTP server for inter-process communication
  const http = require('http');
  const httpServer = http.createServer((req: any, res: any) => {
    if (req.method === 'POST' && req.url === '/update') {
      let body = '';
      req.on('data', (chunk: any) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          console.log('📡 Received update from Next.js:', data.type);

          // Handle the update
          if (data.type === 'albums' && Array.isArray(data.albums)) {
            messageHandler.broadcastAlbums(data.albums);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid update data' }));
          }
        } catch (error) {
          console.error('Error processing update:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  const HTTP_PORT = WS_PORT + 1; // Use port 3003 for HTTP communication
  httpServer.listen(HTTP_PORT, () => {
    console.log(`WebSocket HTTP server listening on port ${HTTP_PORT}`);
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('🔌 WS client connected');

    // Determine if this is an admin client (could be enhanced with authentication)
    const isAdmin = false; // For now, all clients are wall clients
    const clientId = clientManager.addClient(ws, isAdmin);

    // Update admin stats when client connects
    updateAdminStats(clientManager);

    // Send initial data snapshots
    sendInitialData(ws);

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString()) as WSMessage;
        const client = clientManager.getClient(clientId);

        if (client) {
          // Handle admin authentication
          if (data.type === 'auth') {
            client.isAdmin = true;
            updateAdminStats(clientManager);
            console.log(`🔑 Client ${clientId} authenticated as admin`);
          }

          messageHandler.handleMessage(data, client);
        }
      } catch (error) {
        console.warn('WS message parse error:', error);
      }
    });

    ws.on('close', () => {
      console.log('🔌 WS client disconnected');
      clientManager.removeClient(clientId);
      updateAdminStats(clientManager);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clientManager.removeClient(clientId);
      updateAdminStats(clientManager);
    });
  });

  // Set up global functions for API routes
  global.sendWebSocketUpdate = (data: any) => {
    if (data.type === 'albums' && Array.isArray(data.albums)) {
      messageHandler.broadcastAlbums(data.albums);
    } else if (data.type === 'playback') {
      messageHandler.broadcastPlaybackUpdate(data.payload);
    } else if (data.type === 'queue') {
      messageHandler.broadcastQueueUpdate(data.payload);
    } else {
      // Generic broadcast for other message types
      clientManager.broadcast(data);
    }
  };

  global.setSpotifyTokens = ({ accessToken: at, refreshToken: rt }) => {
    if (at) {
      accessToken = at;
      spotifyApi.setAccessToken(accessToken);
    }
    if (rt) {
      refreshToken = rt;
    }
    console.log('🔄 WS tokens updated via callback', { hasAccess: !!accessToken, hasRefresh: !!refreshToken });
  };

  // Start polling for playback updates
  startPlaybackPolling(messageHandler);

  console.log(`🚀 WebSocket server started - polling enabled: ${!!accessToken}`);
  console.log(`🔑 Access token present: ${!!accessToken}, Refresh token present: ${!!refreshToken}`);

  // Start polling immediately if we have tokens
  if (accessToken) {
    console.log('🎵 Starting Spotify playback polling...');
    startPlaybackPolling(messageHandler);
  }
}

function sendInitialData(ws: WebSocket) {
  try {
    // Send albums snapshot
    let albums: any[] | null = null;
    if (fs.existsSync(ALBUMS_FILE)) {
      albums = JSON.parse(fs.readFileSync(ALBUMS_FILE, 'utf8'));
    } else {
      const defaultFile = path.join(DATA_DIR, 'albums.example.json');
      if (fs.existsSync(defaultFile)) {
        albums = JSON.parse(fs.readFileSync(defaultFile, 'utf8'));
      }
    }
    if (albums && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'albums', payload: albums, timestamp: Date.now() }));
    }

    // Send initial playback state if available
    if (accessToken) {
      fetchCurrentPlayback().then(playbackState => {
        if (playbackState && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'playback',
            payload: playbackState,
            timestamp: Date.now()
          }));
        }
      }).catch(() => {/* ignore */});
    }
  } catch (error) {
    console.warn('Error sending initial data:', error);
  }
}

async function fetchCurrentPlayback(): Promise<PlaybackState | null> {
  if (!accessToken) {
    console.log('No access token available for playback polling');
    return null;
  }

  try {
    console.log('Fetching current playback from Spotify API...');

    const [nowPlayingRes, playbackStateRes] = await Promise.all([
      spotifyApi.getMyCurrentPlayingTrack(),
      spotifyApi.getMyCurrentPlaybackState()
    ]);

    console.log('Spotify API responses:', {
      nowPlayingStatus: nowPlayingRes.statusCode,
      playbackStateStatus: playbackStateRes.statusCode,
      hasNowPlayingItem: !!(nowPlayingRes.body as any)?.item,
      hasPlaybackStateItem: !!(playbackStateRes.body as any)?.item,
      isPlayingNowPlaying: (nowPlayingRes.body as any)?.is_playing,
      isPlayingPlaybackState: (playbackStateRes.body as any)?.is_playing
    });

    const currentItem: any = (nowPlayingRes.body as any)?.item || (playbackStateRes.body as any)?.item;

    const playbackState = {
      nowPlaying: currentItem && currentItem.album && currentItem.artists ? {
        id: currentItem.id,
        name: currentItem.name,
        artist: currentItem.artists[0]?.name,
        album: currentItem.album?.name,
        image: currentItem.album?.images?.[0]?.url,
      } : null,
      isPlaying: (nowPlayingRes.body as any)?.is_playing ?? (playbackStateRes.body as any)?.is_playing ?? false,
      queue: [] // Queue fetching would need separate API call
    };

    console.log('Playback state result:', {
      hasTrack: !!playbackState.nowPlaying,
      trackName: playbackState.nowPlaying?.name || 'None',
      isPlaying: playbackState.isPlaying
    });

    return playbackState;
  } catch (error: any) {
    console.error('Error fetching current playback:', {
      message: error.message,
      statusCode: error.statusCode,
      body: error.body
    });
    return null;
  }
}

function startPlaybackPolling(messageHandler: WebSocketMessageHandler) {
  if (!accessToken) return;

  const pollInterval = setInterval(async () => {
    const playbackState = await fetchCurrentPlayback();
    if (playbackState) {
      messageHandler.broadcastPlaybackUpdate(playbackState);
    }
  }, parseInt(process.env.WS_POLLING_INTERVAL || '2000'));

  // Set up token refresh
  setInterval(() => {
    if (refreshToken) {
      refreshAccessToken();
    }
  }, 3000000); // Refresh every 50 minutes
}

async function refreshAccessToken() {
  if (!refreshToken) return;

  try {
    console.log('Refreshing Spotify access token...');
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    const data = await response.json();
    if (data.access_token) {
      accessToken = data.access_token;
      if (data.refresh_token) {
        refreshToken = data.refresh_token;
      }
      spotifyApi.setAccessToken(accessToken);
      console.log('Successfully refreshed Spotify tokens');
    } else {
      console.error('Failed to refresh token:', data);
    }
  } catch (error) {
    console.error('Error refreshing token:', error);
  }
}
