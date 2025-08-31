'use client';

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { normalizeQueue } from "@/lib/spotify/queue";

import { getTokens, clearTokens } from "@/lib/auth/tokens";
import { logger } from "@/lib/utils/logger";
import { getAlbums, addAlbum, removeAlbum, saveAlbumsToStorage, resetToDefaults, setAlbumTracks } from "@/lib/utils/localStorage";
import AddAlbumModal from "@/components/admin/AddAlbumModal";

interface Album {
  id: string;
  name: string;
  artist: string;
  image: string;
  position: number;
  tracks?: { id: string; name: string; duration_ms: number; artist?: string; image?: string }[];
}

interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  image: string;
}

export default function AdminPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [albums, setAlbums] = useState<Album[]>([]);
  const router = useRouter();
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [upNext, setUpNext] = useState<import("@/lib/spotify/queue").MinimalTrack[]>([]);

  // Keep a stable reference to albums to avoid re-triggering searches on add
  const albumsRef = useRef<Album[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(true);
  
  // Helper: broadcast current albums to all clients (no server persistence)
  const syncAlbums = useCallback(async (albumsToSync: Album[]) => {
    try {
      const { accessToken, refreshToken } = getTokens();
      // Strip heavy fields like tracks before broadcasting
      const lightweight = albumsToSync.map(a => ({ id: a.id, name: a.name, artist: a.artist, image: a.image, position: a.position }));
      await fetch('/api/admin/albums/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-spotify-access-token': accessToken,
          'x-spotify-refresh-token': refreshToken,
        },
        body: JSON.stringify(lightweight),
      });
    } catch (e) {
      console.warn('Failed to sync albums to WS:', e);
      throw e;
    }
  }, []);

  // Fetch and persist tracks for any albums missing them
  const ensureTracksForAlbums = useCallback(async (list: Album[]) => {
    const missing = list.filter(a => !Array.isArray(a.tracks) || a.tracks.length === 0);
    for (const a of missing) {
      try {
        const res = await fetch(`/api/album/${a.id}`);
        if (!res.ok) continue;
        const data = await res.json();
        const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
        if (tracks.length > 0) {
          const updated = setAlbumTracks(a.id, tracks);
          setAlbums(updated);
          albumsRef.current = updated;
        }
        // small delay to avoid hitting rate limits
        await new Promise(r => setTimeout(r, 250));
      } catch {}
    }
  }, []);

  const [playbackActionInProgress, setPlaybackActionInProgress] = useState<string | null>(null);
  const playbackActionRef = useRef<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [lastApiCall, setLastApiCall] = useState<number>(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [playbackLoaded, setPlaybackLoaded] = useState(false);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [playbackUpdatePending, setPlaybackUpdatePending] = useState(false);
  const [adminStats, setAdminStats] = useState<{
    totalClients: number;
    adminClients: number;
    wallClients: number;
    lastActivity: string;
    uptime: number;
    serverStartTime: string;
  } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pendingAddId, setPendingAddId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Check auth status on load
    const { accessToken, refreshToken } = getTokens();

    fetch('/api/admin/status', {
      headers: {
        'x-spotify-access-token': accessToken,
        'x-spotify-refresh-token': refreshToken
      }
    })
      .then(res => res.json())
      .then(data => {
        logger.info('Auth status:', data);
        if (!data.authenticated) {
          router.replace('/login');
          setAuthChecked(true);
          return;
        }
        setIsLoggedIn(true);
        setAuthChecked(true);

        // Sync tokens to server/WS so Now Playing can poll Spotify
        fetch('/api/admin/tokens', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-spotify-access-token': accessToken,
            'x-spotify-refresh-token': refreshToken,
          },
          body: JSON.stringify({ accessToken, refreshToken })
        }).then(() => {
          logger.websocket('Synced tokens to server for WS');
        }).catch((e) => {
          console.warn('Failed to sync tokens to server', e);
        });
      })
      .catch(error => {
        console.error('Error checking auth status:', error);
        router.replace('/login');
        setAuthChecked(true);
      });
  }, [router]);

  useEffect(() => {
    if (isLoggedIn) {
      // Check for reset parameter in URL
      const urlParams = new URLSearchParams(window.location.search);
      const shouldReset = urlParams.get('reset') === 'true';

      if (shouldReset) {
        logger.info('Resetting admin to default albums...');
        resetToDefaults()
          .then(async (loaded) => {
            setAlbums(loaded);
            try { await syncAlbums(loaded); } catch {}
            // Fetch tracks for seeded defaults
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            ensureTracksForAlbums(loaded);
          })
          .finally(() => setAlbumsLoading(false));
        // Clean up URL
        window.history.replaceState({}, '', window.location.pathname);
      } else {
        getAlbums()
          .then(async (loaded) => {
            setAlbums(loaded);
            try { await syncAlbums(loaded); } catch {}
            // Ensure tracks exist for initial albums
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            ensureTracksForAlbums(loaded);
          })
          .finally(() => setAlbumsLoading(false));
      }
    }
  }, [isLoggedIn]);



  // Initial queue snapshot will arrive via WebSocket after connect

  // Removed API queue polling; rely on WebSocket updates

  useEffect(() => {
    if (!isLoggedIn) return;

    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000; // 1 second
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let heartbeatInterval: NodeJS.Timeout | null = null;

    const connect = () => {
      if (ws && ws.readyState === WebSocket.OPEN) return;

      ws = new WebSocket(`ws://${window.location.hostname}:3002`);
      wsRef.current = ws;

      ws.onopen = () => {
        logger.websocket('Admin WebSocket connected');
        setWsConnected(true);
        reconnectAttempts = 0;
        // UI can render while snapshot arrives
        setPlaybackLoaded(true);
        setQueueLoaded(true);

        // Request fresh snapshot on connect
        try {
          const { accessToken, refreshToken } = getTokens();
          ws?.send(JSON.stringify({ type: 'auth', accessToken, refreshToken }));
          ws?.send(JSON.stringify({ type: 'refresh' }));

          // Seed queue directly from API as a fallback
          if (accessToken) {
            fetch('/api/queue', {
              headers: { 'x-spotify-access-token': accessToken },
              cache: 'no-store',
            })
              .then(res => res.ok ? res.json() : [])
              .then((payload) => {
                const normalized = normalizeQueue(payload);
                setUpNext(normalized);
                setQueueLoaded(true);
              })
              .catch(() => { /* ignore */ });
          }
        } catch {}

        // Start heartbeat
        heartbeatInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000); // Send ping every 30 seconds
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'pong') return; // Ignore pong responses

          // Validate message structure
          if (typeof data !== 'object' || data === null) {
            console.warn('Invalid WebSocket message format');
            return;
          }

           const messageType = data.type || 'mixed';
           const payload = Object.prototype.hasOwnProperty.call(data, 'payload') ? (data as any).payload : data;

           // Admin stats updates
           if (messageType === 'admin_stats' && data.payload) {
             setAdminStats(data.payload);
            return;
          }

            // Albums-only updates (e.g., from reordering)
           if (messageType === 'albums') {
             let albumsData = null;
             if (Array.isArray(payload)) {
               albumsData = payload;
             } else if (Array.isArray((data as any).albums)) {
               albumsData = (data as any).albums;
             }

             if (albumsData) {
               logger.info('Albums-only update:', albumsData.length, 'albums');
               const albumsChanged = JSON.stringify(albumsData) !== JSON.stringify(albums);
               if (albumsChanged) {
                 setAlbums(albumsData);
                 albumsRef.current = albumsData;
                 // Save to localStorage to keep in sync
                 saveAlbumsToStorage(albumsData);
               }
               return; // Don't process other fields for albums-only updates
             }
           }
          
           // Playback-only updates (e.g., from play/pause/skip)
           if (messageType === 'playback' || (typeof payload === 'object' && payload !== null && ('nowPlaying' in payload || 'isPlaying' in payload || 'queue' in payload))) {
             const p: any = payload;
            
            // Only update nowPlaying if the payload explicitly includes the field
            if (p && 'nowPlaying' in p) {
              setNowPlaying(p.nowPlaying);
            }
            // Update isPlaying if provided
            if (typeof p?.isPlaying === 'boolean') {
              setIsPlaying(p.isPlaying);
            }
            // Only update queue if included (even if empty)
            if (p && 'queue' in p) {
              const normalized = normalizeQueue(p);
              setUpNext(normalized);
            }
            setPlaybackLoaded(true);
            setQueueLoaded(true);

            // Clear loading states when WebSocket confirms updates
            setPlaybackUpdatePending(false);

            // Clear timeout since we got the WebSocket update
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }

            // Re-enable playback button now that state is synchronized
            setPlaybackActionInProgress(null);
            playbackActionRef.current = null;
            return;
          }
          
           // Mixed updates (fallback for legacy messages that contain everything)
           if (messageType === 'mixed') {
             if (Array.isArray((payload as any)?.albums)) {
               const albumsPayload = (payload as any).albums as Album[];
               const albumsChanged = JSON.stringify(albumsPayload) !== JSON.stringify(albums);
               if (albumsChanged) {
                 setAlbums(albumsPayload);
               }
             }
            
            // Only update nowPlaying if the payload explicitly includes the field
            if (payload && typeof payload === 'object' && 'nowPlaying' in (payload as any)) {
              setNowPlaying((payload as any).nowPlaying);
            }
            // Update isPlaying if provided
            if (typeof (payload as any)?.isPlaying === 'boolean') {
              setIsPlaying((payload as any).isPlaying);

              // Clear timeout since we got the WebSocket update
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
              }

              // Re-enable playback button now that state is synchronized
              setPlaybackActionInProgress(null);
              playbackActionRef.current = null;
            }
            // Only update queue if included (even if empty)
            if (payload && typeof payload === 'object' && 'queue' in (payload as any)) {
              const normalized = normalizeQueue(payload);
              setUpNext(normalized);
            }
            setPlaybackLoaded(true);
            setQueueLoaded(true);

            // Clear loading states when WebSocket confirms updates

            setPlaybackUpdatePending(false);
            return;
          }

          } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        logger.websocket('Admin WebSocket disconnected, attempting reconnection...');
        setWsConnected(false);
        wsRef.current = null;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }

        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
          reconnectTimeout = setTimeout(() => {
            reconnectAttempts++;
            connect();
          }, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('Admin WebSocket error:', error);
        setWsConnected(false);
      };
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (ws) ws.close();
      wsRef.current = null;
    };
  }, [isLoggedIn]);



  useEffect(() => {
    // Keep albumsRef in sync with latest albums
    albumsRef.current = albums;
  }, [albums]);





  const handleRemoveAlbum = async (id: string) => {
    // Store the album for potential rollback
    const albumToRemove = albums.find(album => album.id === id);
    if (!albumToRemove) {
      console.error('Album not found for removal:', id);
      return;
    }

    // Optimistic update: Remove album from UI immediately
    const optimisticAlbums = removeAlbum(id);
    setAlbums(optimisticAlbums);
    albumsRef.current = optimisticAlbums;

    try {
      // Broadcast updated albums to all clients
      await syncAlbums(optimisticAlbums);
    } catch (error) {
      console.error('❌ Error removing album:', error);

      // Rollback: Add the album back
      try {
        const rollbackAlbums = addAlbum(albumToRemove);
        setAlbums(rollbackAlbums);
        albumsRef.current = rollbackAlbums;

        // Show error to user
        alert(`Failed to remove album "${albumToRemove.name}". Please try again.`);
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }
    }
  };

    const handlePlaybackAction = useCallback(async (action: string, endpoint: string) => {
      const now = Date.now();

      // Rate limiting: Prevent API calls more frequent than every 1000ms
      if (now - lastApiCall < 1000) {
        console.log(`Playback action ${action} rate limited - too soon after last call`);
        return;
      }

      // Double-check: Prevent multiple simultaneous playback actions using ref for immediate check
      if (playbackActionRef.current) {
        console.log(`Playback action ${action} blocked - ${playbackActionRef.current} already in progress`);
        return;
      }

      // Record this API call
      setLastApiCall(now);

      // Optimistically update the UI immediately
      let originalIsPlaying = isPlaying;

      if (action === 'play') {
        setIsPlaying(true);
      } else if (action === 'pause') {
        setIsPlaying(false);
      }

      try {
        // Clear any existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // Disable button during API call
        setPlaybackActionInProgress(action);
        playbackActionRef.current = action;
        console.log(`🎵 Starting ${action} request...`);

        // Set a timeout to re-enable button if WebSocket doesn't respond within 5 seconds
        timeoutRef.current = setTimeout(() => {
          if (playbackActionRef.current === action) {
            console.log(`⏰ Timeout: Re-enabling ${action} button after 5 seconds`);
            setPlaybackActionInProgress(null);
            playbackActionRef.current = null;
            timeoutRef.current = null;
          }
        }, 5000);

        const { accessToken, refreshToken } = getTokens();
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'x-spotify-access-token': accessToken,
            'x-spotify-refresh-token': refreshToken,
          },
        });

        if (!res.ok) {
          throw new Error(`Playback ${action} failed with status ${res.status}`);
        }

        logger.success(`Playback ${action} successful`);

      } catch (error) {
        logger.error(`Error ${action}:`, error);

        // Revert optimistic update on error
        setIsPlaying(originalIsPlaying);

        // Clear timeout on error
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }

        // Re-enable button on error
        setPlaybackActionInProgress(null);
        playbackActionRef.current = null;
      } finally {
        // Don't re-enable button yet - wait for WebSocket confirmation
        // The button will be re-enabled when playbackUpdatePending becomes false
        console.log(`🔄 ${action} API request completed, waiting for WebSocket sync`);
      }
    }, [isPlaying, playbackActionInProgress, lastApiCall]);



  const handleAddAlbum = async (album: Album) => {
    setPendingAddId(album.id);

    // Optimistic update: Add album to UI immediately
    const optimisticAlbums = addAlbum(album);
    setAlbums(optimisticAlbums);
    albumsRef.current = optimisticAlbums;

    try {
      // Fetch tracks for the album and persist to localStorage
      const res = await fetch(`/api/album/${album.id}`);
      if (res.ok) {
        const data = await res.json();
        const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
        if (tracks.length > 0) {
          const updatedWithTracks = setAlbumTracks(album.id, tracks);
          setAlbums(updatedWithTracks);
          albumsRef.current = updatedWithTracks;
          // Broadcast lightweight album list (no tracks)
          await syncAlbums(updatedWithTracks);
        } else {
          // No tracks found; still broadcast current state
          await syncAlbums(optimisticAlbums);
        }
      } else {
        await syncAlbums(optimisticAlbums);
      }
    } catch (error) {
      console.error('❌ Error adding album:', error);

      // Rollback: Remove the optimistically added album
      try {
        const rollbackAlbums = removeAlbum(album.id);
        setAlbums(rollbackAlbums);
        albumsRef.current = rollbackAlbums;

        // Show error to user
        alert(`Failed to add album "${album.name}". Please try again.`);
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }
    } finally {
      // Clear pending state
      setPendingAddId(null);
    }
  };

  const handleLogout = async () => {
    try {
      // Clear tokens from localStorage
      clearTokens();

      // Also call logout API for any server-side cleanup
      await fetch('/api/admin/logout', { method: 'POST' });

      router.push('/login');
    } catch (error) {
      console.error('Error logging out:', error);
      // Still redirect to login even if logout API fails
      router.push('/login');
    }
  };





  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-800" />
      </div>
    );
  }

  if (!isLoggedIn) {
    // Rendering nothing to avoid flicker; router.replace('/login') handles navigation
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white overflow-hidden">
      {/* Header */}
      <header className="bg-gray-800 shadow-sm px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Music Admin Panel</h1>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm text-gray-300">
                {wsConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
              title="Logout"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="grid grid-cols-1 grid-rows-[auto_1fr] gap-6 h-[calc(100vh-80px)] p-6 max-w-[1600px] mx-auto">
        {/* Now Playing Section */}
        <div className="bg-gray-800 rounded-2xl p-6 h-[180px] flex items-center justify-center">
          <div className="flex items-center gap-8">
            <div className="w-[120px] h-[120px] bg-gray-700 rounded-lg flex-shrink-0 overflow-hidden">
              {nowPlaying?.image ? (
                <img
                  src={nowPlaying.image}
                  alt="Album cover"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-orange-400 to-orange-600"></div>
              )}
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="text-2xl font-semibold mb-2 whitespace-nowrap overflow-hidden text-ellipsis max-w-[300px]">
                {nowPlaying?.name || 'No track playing'}
              </div>
              <div className="text-base text-gray-400 mb-5">
                {nowPlaying?.artist || ''}
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => handlePlaybackAction('previous', '/api/playback/playback/previous')}
                  disabled={!!playbackActionInProgress}
                  className="w-9 h-9 bg-gray-700 border border-gray-600 rounded-full flex items-center justify-center hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  ⟵
                </button>
                <button
                  onClick={() => handlePlaybackAction(isPlaying ? 'pause' : 'play', `/api/playback/playback/${isPlaying ? 'pause' : 'play'}`)}
                  disabled={!!playbackActionInProgress}
                  className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <button
                  onClick={() => handlePlaybackAction('next', '/api/playback/playback/next')}
                  disabled={!!playbackActionInProgress}
                  className="w-9 h-9 bg-gray-700 border border-gray-600 rounded-full flex items-center justify-center hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  ⟶
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="grid grid-cols-[2fr_1fr] gap-6 min-h-0">
          {/* Current Wall Section */}
          <div className="bg-gray-800 rounded-2xl p-6 flex flex-col overflow-hidden">
            <div className="mb-5 flex-shrink-0 flex items-center justify-between">
              <button
                onClick={() => setShowAddModal(true)}
                className="text-white hover:text-gray-300 text-lg flex items-center transition-colors"
                title="Add Album"
              >
                <span className="text-2xl mr-2">+</span>
                <span>Add Album</span>
              </button>
              <h2 className="text-xl font-semibold text-center flex-1">Current Wall</h2>
              <div className="w-8"></div> {/* Spacer for balance */}
            </div>
            <div className="flex-1 overflow-y-auto pr-2">
              <div className="grid grid-cols-3 gap-4">
                {albumsLoading ? (
                  Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} className="aspect-square bg-gray-700 rounded-xl" />
                  ))
                ) : (
                  [...albums]
                    .sort((a, b) => a.position - b.position)
                     .map((album) => (
                       <div key={album.id} className="group relative flex flex-col">
                         <div className="relative aspect-square bg-gray-700 rounded-xl overflow-hidden cursor-pointer hover:scale-105 transition-transform">
                           <img
                             src={album.image}
                             alt={`${album.name} album cover`}
                             className="w-full h-full object-cover"
                           />
                           <button
                             onClick={() => handleRemoveAlbum(album.id)}
                             className="absolute top-2 right-2 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                           >
                             ×
                           </button>
                         </div>
                         <div className="mt-2 px-1">
                           <div className="text-sm font-semibold whitespace-nowrap overflow-hidden text-ellipsis">
                             {album.name}
                           </div>
                           <div className="text-xs text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis">
                             {album.artist}
                           </div>
                         </div>
                       </div>
                     ))
                )}
              </div>
            </div>
          </div>

            {/* Queue Section */}
            <div className="bg-gray-800 rounded-2xl p-6 flex flex-col overflow-hidden">
            <div className="mb-5 flex-shrink-0">
              <h2 className="text-xl font-semibold text-center">Up Next</h2>
            </div>
              <div className="flex-1 overflow-y-auto pr-2">
                <div className="space-y-3">
                  {upNext.length > 0 ? (
                    upNext.map((track, index) => (
                      <div key={index} className="flex items-center p-3 bg-gray-700 rounded-lg">
                        <div className="w-6 h-6 text-gray-400 mr-3">☰</div>
                        <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded mr-3"></div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis">
                            {track.name}
                          </div>
                          <div className="text-xs text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis">
                            {track.artist}
                          </div>
                        </div>
                        <button className="w-8 h-8 text-red-500 rounded-full flex items-center justify-center hover:bg-red-500/10 opacity-0 hover:opacity-100 transition-opacity">
                          ⊖
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-gray-400 text-center py-8">Queue is empty</div>
                  )}
                </div>
              </div>
            </div>
        </div>
      </div>
      <AddAlbumModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAddAlbum={async (album) => {
          await handleAddAlbum(album);
        }}
      />
    </div>
  );
}
