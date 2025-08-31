import WebSocket, { WebSocketServer } from 'ws';
import SpotifyWebApi from 'spotify-web-api-node';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from '@/lib/utils/env';
import { WebSocketClientManager } from './client-manager';
import { WebSocketMessageHandler } from './message-handlers';
import { WSMessage, Album, Track, PlaybackState } from './types';
import { logger } from '@/lib/utils/logger';

// Declare global type for WebSocket update function
declare global {
  var sendWebSocketUpdate: (data: any) => void;
  var setSpotifyTokens: (tokens: { accessToken?: string; refreshToken?: string }) => void;
}

// In-memory snapshot of albums to share with new clients
let currentAlbums: Album[] = [];

// No filesystem persistence for albums; kept in-memory via currentAlbums

// OAuth variables
let accessToken = '';
let refreshToken = '';
let playbackPollInterval: NodeJS.Timeout | null = null;

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
  redirectUri: SPOTIFY_REDIRECT_URI,
});

// No file-based token persistence; tokens are provided by clients
logger.info('WS tokens: using in-memory tokens only (no file persistence)');

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
  // In-memory snapshot of albums for new clients (no file persistence)

  logger.info(`WebSocket server listening on port ${WS_PORT}`);

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
          logger.api('Received update from Next.js:', data.type);

          // Handle the update
          if (data.type === 'albums' && Array.isArray(data.albums)) {
            currentAlbums = data.albums as Album[];
            messageHandler.broadcastAlbums(currentAlbums);
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
    } else if (req.method === 'POST' && req.url === '/queue/add') {
      // Add a track to the Spotify queue using WS server tokens
      if (!accessToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'WS server not authenticated with Spotify' }));
        return;
      }
      let body = '';
      req.on('data', (chunk: any) => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const { trackId } = JSON.parse(body || '{}');
          if (!trackId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing trackId' }));
            return;
          }

          // Ensure we have an active device
          const devices = await spotifyApi.getMyDevices();
          const activeDevice = devices.body.devices.find(d => d.is_active);
          if (!activeDevice) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No active Spotify device found' }));
            return;
          }

          await spotifyApi.addToQueue(`spotify:track:${trackId}`, { device_id: activeDevice.id || undefined });

          // Fetch queue and broadcast update
          try {
            const queueRes = await fetch('https://api.spotify.com/v1/me/player/queue', {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (queueRes.ok) {
              const queueJson: any = await queueRes.json();
              const items: any[] = Array.isArray(queueJson?.queue) ? queueJson.queue : [];
              const normalized = items.map((t: any) => ({
                id: t?.id,
                uri: t?.uri,
                name: t?.name ?? '',
                artist: t?.artists?.[0]?.name,
                album: t?.album?.name ?? '',
                image: t?.album?.images?.[0]?.url,
              }));
              messageHandler.broadcastQueueUpdate(normalized as any);
            }
          } catch {/* ignore */}

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e: any) {
          logger.error('WS HTTP /queue/add error:', e?.message || e);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to add to queue' }));
        }
      });
    } else if (req.method === 'GET' && req.url === '/queue') {
      if (!accessToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'WS server not authenticated with Spotify' }));
        return;
      }
      (async () => {
        try {
          const queueRes = await fetch('https://api.spotify.com/v1/me/player/queue', {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!queueRes.ok) {
            res.writeHead(queueRes.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch queue' }));
            return;
          }
          const queueJson: any = await queueRes.json();
          const items: any[] = Array.isArray(queueJson?.queue) ? queueJson.queue : [];
          const normalized = items.map((t: any) => ({
            id: t?.id,
            uri: t?.uri,
            name: t?.name ?? '',
            artist: t?.artists?.[0]?.name,
            image: t?.album?.images?.[0]?.url,
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(normalized));
        } catch (e: any) {
          logger.error('WS HTTP /queue error:', e?.message || e);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Queue fetch error' }));
        }
      })();
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  const HTTP_PORT = WS_PORT + 1; // Use port 3003 for HTTP communication
  httpServer.listen(HTTP_PORT, () => {
    logger.info(`WebSocket HTTP server listening on port ${HTTP_PORT}`);
  });

  wss.on('connection', (ws: WebSocket) => {
    logger.websocket('WS client connected');

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
            logger.info(`Client ${clientId} authenticated as admin`);

            // Extract and set Spotify tokens
            const authData = data as any;
            if (authData.accessToken) {
              accessToken = authData.accessToken;
              spotifyApi.setAccessToken(accessToken);
              logger.info('WS access token set from client auth');
            }
            if (authData.refreshToken) {
              refreshToken = authData.refreshToken;
              logger.info('WS refresh token set from client auth');
            }

            // Start polling if we now have tokens
            if (accessToken) {
              logger.playback('Starting Spotify playback polling after auth...');
              startPlaybackPolling(messageHandler);
            }
          }

          // Allow clients (admin) to force a fresh snapshot
          if (data.type === 'refresh') {
            try {
              const snapshot = await fetchCurrentPlayback();
              if (snapshot) {
                messageHandler.broadcastPlaybackUpdate(snapshot);
              }
            } catch (e) {
              logger.warn('Error handling refresh request', e as any);
            }
          }

          messageHandler.handleMessage(data, client);
        }
      } catch (error) {
        console.warn('WS message parse error:', error);
      }
    });

    ws.on('close', () => {
      logger.websocket('WS client disconnected');
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
      currentAlbums = data.albums as Album[];
      messageHandler.broadcastAlbums(currentAlbums);
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
    logger.info('WS tokens updated via callback', { hasAccess: !!accessToken, hasRefresh: !!refreshToken });
  };

  logger.info(`WebSocket server started - polling enabled: ${!!accessToken}`);
  logger.info(`Access token present: ${!!accessToken}, Refresh token present: ${!!refreshToken}`);

  // Start polling if we have tokens
  if (accessToken) {
    startPlaybackPolling(messageHandler);
  }
}

function sendInitialData(ws: WebSocket) {
  try {
    // Send latest albums snapshot kept in memory (if available)
    // This keeps new clients in sync without touching the filesystem
    if (Array.isArray(currentAlbums) && currentAlbums.length > 0) {
      try {
        ws.send(JSON.stringify({ type: 'albums', payload: currentAlbums, timestamp: Date.now() }));
      } catch {/* ignore */}
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
    // Nothing else to defer here
  } catch (error) {
    console.warn('Error sending initial data:', error);
  }
}

async function fetchCurrentPlayback(): Promise<PlaybackState | null> {
  if (!accessToken) {
    logger.warn('No access token available for playback polling');
    return null;
  }

  try {
    logger.api('Fetching current playback from Spotify API...');

    const [nowPlayingRes, playbackStateRes] = await Promise.all([
      spotifyApi.getMyCurrentPlayingTrack(),
      spotifyApi.getMyCurrentPlaybackState()
    ]);

    logger.api('Spotify API responses:', {
      nowPlayingStatus: nowPlayingRes.statusCode,
      playbackStateStatus: playbackStateRes.statusCode,
      hasNowPlayingItem: !!(nowPlayingRes.body as any)?.item,
      hasPlaybackStateItem: !!(playbackStateRes.body as any)?.item,
      isPlayingNowPlaying: (nowPlayingRes.body as any)?.is_playing,
      isPlayingPlaybackState: (playbackStateRes.body as any)?.is_playing
    });

    const currentItem: any = (nowPlayingRes.body as any)?.item || (playbackStateRes.body as any)?.item;

    // Fetch queue via Spotify's queue endpoint
    let queueTracks: Track[] = [];
    try {
      const queueRes = await fetch('https://api.spotify.com/v1/me/player/queue', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (queueRes.ok) {
        const queueJson: any = await queueRes.json();
        const items: any[] = Array.isArray(queueJson?.queue) ? queueJson.queue : [];
        queueTracks = items.map((t: any) => ({
          id: t?.id,
          uri: t?.uri,
          name: t?.name,
          artist: t?.artists?.[0]?.name,
          album: t?.album?.name,
          image: t?.album?.images?.[0]?.url,
        }));
      } else {
        logger.warn('Spotify queue fetch failed', { status: queueRes.status });
      }
    } catch (e) {
      logger.warn('Error fetching Spotify queue', e as any);
    }

    // Fallback: if queue is empty, try deriving the next track from playback context (album/playlist)
    if (queueTracks.length === 0 && currentItem) {
      try {
        const contextUri: string | undefined = (playbackStateRes.body as any)?.context?.uri;
        if (contextUri?.startsWith('spotify:album:')) {
          const albumId = contextUri.split(':')[2];
          const albumRes = await fetch(`https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (albumRes.ok) {
            const albumData: any = await albumRes.json();
            const tracks: any[] = albumData?.items || [];
            const idx = tracks.findIndex((t: any) => t?.id === currentItem.id);
            const next = idx >= 0 ? tracks[idx + 1] : undefined;
            if (next) {
              queueTracks = [{
                id: next.id,
                uri: next.uri,
                name: next.name,
                artist: next.artists?.[0]?.name,
                album: (playbackStateRes.body as any)?.item?.album?.name,
                image: (playbackStateRes.body as any)?.item?.album?.images?.[0]?.url,
              }];
            }
          }
        } else if (contextUri?.startsWith('spotify:playlist:')) {
          const playlistId = contextUri.split(':')[2];
          // Fetch first 100 tracks; adequate for next-up determination
          const plRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (plRes.ok) {
            const plData: any = await plRes.json();
            const items: any[] = plData?.items || [];
            const tracks = items.map((it: any) => it?.track).filter(Boolean);
            const idx = tracks.findIndex((t: any) => t?.id === currentItem.id);
            const next = idx >= 0 ? tracks[idx + 1] : undefined;
            if (next) {
              queueTracks = [{
                id: next.id,
                uri: next.uri,
                name: next.name,
                artist: next.artists?.[0]?.name,
                album: next.album?.name,
                image: next.album?.images?.[0]?.url,
              }];
            }
          }
        }
      } catch (e) {
        logger.debug('Queue fallback failed', e as any);
      }
    }

    const playbackState = {
      nowPlaying: currentItem && currentItem.album && currentItem.artists ? {
        id: currentItem.id,
        name: currentItem.name,
        artist: currentItem.artists[0]?.name,
        album: currentItem.album?.name,
        image: currentItem.album?.images?.[0]?.url,
      } : null,
      isPlaying: (nowPlayingRes.body as any)?.is_playing ?? (playbackStateRes.body as any)?.is_playing ?? false,
      queue: queueTracks
    };

    logger.playback('Playback state result:', {
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

  // Prevent multiple polling intervals
  if (playbackPollInterval) {
    logger.info('Playback polling already running, skipping...');
    return;
  }

  logger.playback('Starting playback polling with interval:', parseInt(process.env.WS_POLLING_INTERVAL || '2000'), 'ms');

  playbackPollInterval = setInterval(async () => {
    logger.debug('Polling Spotify for current playback...');
    const playbackState = await fetchCurrentPlayback();
    if (playbackState) {
      logger.websocket('Broadcasting playback update:', {
        hasTrack: !!playbackState.nowPlaying,
        trackName: playbackState.nowPlaying?.name || 'None',
        isPlaying: playbackState.isPlaying
      });
      messageHandler.broadcastPlaybackUpdate(playbackState);
    } else {
      logger.debug('No playback state to broadcast');
    }
  }, parseInt(process.env.WS_POLLING_INTERVAL || '2000'));

  // Set up token refresh
  setInterval(() => {
    if (refreshToken) {
      logger.info('Refreshing Spotify access token...');
      refreshAccessToken();
    }
  }, 3000000); // Refresh every 50 minutes
}

async function refreshAccessToken() {
  if (!refreshToken) return;

  try {
    logger.info('Refreshing Spotify access token...');
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
      logger.success('Successfully refreshed Spotify tokens');
    } else {
      console.error('Failed to refresh token:', data);
    }
  } catch (error) {
    console.error('Error refreshing token:', error);
  }
}
