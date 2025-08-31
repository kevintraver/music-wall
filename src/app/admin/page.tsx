'use client';

import { useEffect, useState, useRef, useCallback } from "react";
import Skeleton from "@/components/Skeleton";
import AlbumWall from "@/components/AlbumWall";
import { normalizeQueue } from "@/lib/queue";
import NowPlayingPanel from "@/components/NowPlayingPanel";
import { useRouter } from "next/navigation";
import { getTokens, clearTokens } from "@/lib/tokens";
import { getAlbums, addAlbum as addAlbumToStorage, removeAlbum as removeAlbumFromStorage, reorderAlbums, saveAlbumsToStorage, resetToDefaults } from "@/lib/localStorage";

interface Album {
  id: string;
  name: string;
  artist: string;
  image: string;
  position: number;
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
  const [upNext, setUpNext] = useState<import("@/lib/queue").MinimalTrack[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Album[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [pendingAddId, setPendingAddId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  // Keep a stable reference to albums to avoid re-triggering searches on add
  const albumsRef = useRef<Album[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(true);
  // Drag-and-drop state is isolated inside AlbumWall to avoid unrelated re-renders
  const [playbackUpdatePending, setPlaybackUpdatePending] = useState(false);
  const [playbackLoaded, setPlaybackLoaded] = useState(false);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [playbackActionLoading, setPlaybackActionLoading] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [showWsTooltip, setShowWsTooltip] = useState(false);
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
        console.log('Auth status:', data);
        if (!data.authenticated) {
          router.replace('/login');
          setAuthChecked(true);
          return;
        }
        setIsLoggedIn(true);
        setAuthChecked(true);
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
        console.log('🔄 Resetting admin to default albums...');
        resetToDefaults()
          .then(setAlbums)
          .finally(() => setAlbumsLoading(false));
        // Clean up URL
        window.history.replaceState({}, '', window.location.pathname);
      } else {
        getAlbums()
          .then(setAlbums)
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
        console.log('Admin WebSocket connected');
        setWsConnected(true);
        reconnectAttempts = 0;
        // UI can render while snapshot arrives
        setPlaybackLoaded(true);
        setQueueLoaded(true);

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

          console.log('📨 WS message received (admin):', {
            type: data?.type,
            hasNowPlaying: Object.prototype.hasOwnProperty.call(data || {}, 'nowPlaying'),
            hasQueue: Object.prototype.hasOwnProperty.call(data || {}, 'queue'),
            nowPlaying: data?.nowPlaying?.name || null,
          });
          
          // Handle different message types to avoid cross-contamination
          const messageType = data.type || 'mixed';
          
          // Albums-only updates (e.g., from reordering)
          if (messageType === 'albums' || (data.albums && Array.isArray(data.albums) && !('nowPlaying' in data) && !('queue' in data))) {
            console.log('💿 Albums-only update:', data.albums.length, 'albums');
            const albumsChanged = JSON.stringify(data.albums) !== JSON.stringify(albums);
            if (albumsChanged) {
              setAlbums(data.albums);
              albumsRef.current = data.albums;
              // Save to localStorage to keep in sync
              saveAlbumsToStorage(data.albums);
            }
            return; // Don't process other fields for albums-only updates
          }
          
          // Playback-only updates (e.g., from play/pause/skip)
          if (messageType === 'playback' || ('nowPlaying' in data || 'isPlaying' in data || 'queue' in data)) {
            if (data.nowPlaying) {
              console.log('🎵 (admin) now playing:', data.nowPlaying.name, 'by', data.nowPlaying.artist);
            }
            if (Array.isArray?.(data.queue)) {
              console.log('Queue updated:', data.queue.map((t: any) => t.name).join(', '));
            }
            
            // Only update nowPlaying if the payload explicitly includes the field
            if ('nowPlaying' in data) {
              setNowPlaying(data.nowPlaying);
            }
            // Update isPlaying if provided
            if (typeof data.isPlaying === 'boolean') {
              setIsPlaying(data.isPlaying);
            }
            // Only update queue if included (even if empty)
            if ('queue' in data) {
              const normalized = normalizeQueue(data);
              setUpNext(normalized);
            }
            setPlaybackLoaded(true);
            setQueueLoaded(true);

            // Clear loading states when WebSocket confirms updates
            setPlaybackActionLoading(null);
            setPlaybackUpdatePending(false);
            return;
          }
          
          // Mixed updates (fallback for legacy messages that contain everything)
          if (messageType === 'mixed') {
            if (data.albums && Array.isArray(data.albums)) {
              console.log('Albums updated:', data.albums.length, 'albums');
              const albumsChanged = JSON.stringify(data.albums) !== JSON.stringify(albums);
              if (albumsChanged) {
                setAlbums(data.albums);
              }
            }
            if (data.nowPlaying) {
              console.log('Now playing:', data.nowPlaying.name, 'by', data.nowPlaying.artist);
            }
            if (Array.isArray?.(data.queue)) {
              console.log('Queue updated:', data.queue.map((t: any) => t.name).join(', '));
            }
            
            // Only update nowPlaying if the payload explicitly includes the field
            if ('nowPlaying' in data) {
              setNowPlaying(data.nowPlaying);
            }
            // Update isPlaying if provided
            if (typeof data.isPlaying === 'boolean') {
              setIsPlaying(data.isPlaying);
            }
            // Only update queue if included (even if empty)
            if ('queue' in data) {
              const normalized = normalizeQueue(data);
              setUpNext(normalized);
            }
            setPlaybackLoaded(true);
            setQueueLoaded(true);

            // Clear loading states when WebSocket confirms updates
            setPlaybackActionLoading(null);
            setPlaybackUpdatePending(false);
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('Admin WebSocket disconnected, attempting reconnection...');
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



  const performSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) { setSearchResults([]); return; }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Search failed');
       const results: Album[] = await res.json();
       // Include all results, even those already in the wall
       setSearchResults(results);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setSearchResults([]);
      }
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    // Keep albumsRef in sync with latest albums
    albumsRef.current = albums;
  }, [albums]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    if (searchQuery.trim()) {
      setIsDebouncing(true);
      debounceRef.current = window.setTimeout(() => {
        setIsDebouncing(false);
        performSearch(searchQuery);
      }, 300);
    } else {
      setIsDebouncing(false);
      setSearchResults([]);
    }

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const addAlbum = async (album: Album) => {
    setPendingAddId(album.id);
    try {
      // Add album to localStorage
      const updatedAlbums = addAlbumToStorage(album);

      // Update UI state
      setAlbums(updatedAlbums);
      albumsRef.current = updatedAlbums;

      // Broadcast update to all clients via WebSocket
      if (global.sendWebSocketUpdate) {
        global.sendWebSocketUpdate({
          type: 'albums',
          albums: updatedAlbums
        });
      }

      // Remove added album from search results but keep query
      setSearchResults(prev => prev.filter(a => a.id !== album.id));
    } catch (error) {
      console.error('Error adding album:', error);
    } finally {
      // Clear pending state
      setPendingAddId(null);
    }
  };

  const removeAlbum = async (id: string) => {
    try {
      // Remove album from localStorage
      const updatedAlbums = removeAlbumFromStorage(id);

      // Update UI state
      setAlbums(updatedAlbums);
      albumsRef.current = updatedAlbums;

      // Broadcast update to all clients via WebSocket
      if (global.sendWebSocketUpdate) {
        global.sendWebSocketUpdate({
          type: 'albums',
          albums: updatedAlbums
        });
      }
    } catch (error) {
      console.error('Error removing album:', error);
    }
  };

  const handlePlaybackAction = useCallback(async (action: string, endpoint: string) => {
    // Don't show loading for pause/play actions (immediate feedback)
    if (action !== 'pause' && action !== 'play') {
      setPlaybackActionLoading(action);
    }
    if (action !== 'pause' && action !== 'play') {
      setPlaybackUpdatePending(true);
    }

    // Optimistically update UI for play/pause
    if (action === 'play' || action === 'pause') {
      setIsPlaying(action === 'play');
    }

    try {
      const { accessToken, refreshToken } = getTokens();
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-spotify-access-token': accessToken,
          'x-spotify-refresh-token': refreshToken,
        },
      });
      if (!res.ok) {
        throw new Error(`Playback ${action} failed`);
      }
      // Keep loading state until WebSocket confirms the update (except for pause/play)
      if (action !== 'pause' && action !== 'play') {
        setTimeout(() => {
          if (playbackActionLoading === action) {
            setPlaybackActionLoading(null);
            setPlaybackUpdatePending(false);
          }
        }, 2000); // Fallback timeout
      } else {
        // For pause/play, clear immediately since they're typically instant
        setPlaybackActionLoading(null);
        setPlaybackUpdatePending(false);
      }
    } catch (error) {
      console.error(`Error ${action}:`, error);
      // Revert optimistic updates on error
      if (action === 'play' || action === 'pause') {
        setIsPlaying(action === 'pause'); // Revert to opposite
      }
      setPlaybackActionLoading(null);
      setPlaybackUpdatePending(false);
    }
  }, []);

  // Handle album reorder coming from AlbumWall
  const handleReorder = async (updatedAlbums: Album[]) => {
    // Save reordered albums to localStorage
    reorderAlbums(updatedAlbums);

    // Update UI state
    setAlbums(updatedAlbums);
    albumsRef.current = updatedAlbums;

    // Broadcast update to all clients via WebSocket
    if (global.sendWebSocketUpdate) {
      global.sendWebSocketUpdate({
        type: 'albums',
        albums: updatedAlbums
      });
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
    <>
      <div className="min-h-screen flex flex-col bg-gray-100">
        <header className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-bold leading-tight text-gray-900">Admin Dashboard</h1>
              <div className="flex items-center space-x-4">
                 <div className="flex items-center space-x-2">
                   <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span
                      className="text-sm text-gray-600 cursor-help"
                      onMouseEnter={() => setShowWsTooltip(true)}
                      onMouseLeave={() => setShowWsTooltip(false)}
                    >
                      {wsConnected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                 <button
                  onClick={handleLogout}
                  className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm"
                  title="Logout"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-grow">
          <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Now Playing panel */}
              <NowPlayingPanel
                nowPlaying={nowPlaying}
                isPlaying={isPlaying}
                playbackLoaded={playbackLoaded}
                playbackUpdatePending={playbackUpdatePending}
                playbackActionLoading={playbackActionLoading}
                onAction={handlePlaybackAction}
                colSpan="lg:col-span-2"
              />

              {/* Queue panel */}
              <div className="lg:col-span-1 bg-white p-6 rounded-xl shadow-md flex flex-col">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Queue</h2>
                <div className="flex-grow space-y-4">
                  {queueLoaded ? (
                    <ul className="space-y-3">
                      {upNext.length === 0 && (
                        <li className="text-gray-500">Queue is empty</li>
                      )}
                      {upNext.map((t) => (
                        <li key={(t as any).id ?? (t as any).uri ?? `${t.name}-${t.artist}`}
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100">
                          <div className="flex items-center space-x-4">
                            <span className="material-icons text-gray-400">drag_indicator</span>
                            <div>
                              <p className="font-medium text-gray-900">{t.name}</p>
                              <p className="text-sm text-gray-500">{t.artist}</p>
                            </div>
                          </div>
                          <button className="text-red-500 hover:text-red-700" title="Remove from queue" disabled>
                            <span className="material-icons">remove_circle_outline</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="space-y-3">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <li key={i} className="p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center space-x-4">
                            <Skeleton className="w-6 h-6 rounded" />
                            <div className="flex-1">
                              <Skeleton className="w-2/3 h-4" />
                              <Skeleton className="w-1/3 h-3 mt-2" />
                            </div>
                            <Skeleton className="w-6 h-6 rounded-full" />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Wall (left) + Search (right) */}
            <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Wall left: 2 columns */}
              <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-md">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Current Wall</h2>
                <AlbumWall
                  albums={albums}
                  albumsLoading={albumsLoading}
                  onReorder={handleReorder}
                  onRemove={removeAlbum}
                />
              </div>

              {/* Search right: 1 column with internal scroll */}
              <div className="lg:col-span-1 bg-white p-0 rounded-xl shadow-md flex flex-col h-[72vh] overflow-hidden">
                <div className="p-6 border-b sticky top-0 bg-white z-10 rounded-t-xl">
                  <h2 className="text-xl font-semibold text-gray-800 mb-4">Add Albums</h2>
                  <div className="relative">
                    <span className="material-icons pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">search</span>
                    <input
                      type="text"
                      inputMode="search"
                      aria-label="Search albums"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="Search albums..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          // eslint-disable-next-line @typescript-eslint/no-floating-promises
                          performSearch(searchQuery);
                        }
                      }}
                      className="w-full pl-10 pr-12 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-gray-900"
                    />
                    {searchQuery && !isSearching && (
                      <button
                        aria-label="Clear search"
                        onClick={() => { setSearchQuery(''); setSearchResults([]); setIsDebouncing(false); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        type="button"
                      >
                        <span className="material-icons text-lg">close</span>
                      </button>
                    )}
                    {isSearching && (
                      <span className="material-icons animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" aria-live="polite" aria-busy="true">autorenew</span>
                    )}
                  </div>
                </div>
                <div className="p-6 overflow-y-auto flex-1">
                  {(isSearching || searchQuery.trim()) && (
                    <>
                      <ul className="space-y-3">
                        {isSearching && (
                          Array.from({ length: 6 }).map((_, i) => (
                            <li key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                              <div className="flex items-center space-x-4">
                                <Skeleton className="w-12 h-12 rounded-md" />
                                <div>
                                  <Skeleton className="w-40 h-4" />
                                  <Skeleton className="w-28 h-3 mt-2" />
                                </div>
                              </div>
                              <Skeleton className="w-6 h-6 rounded-full" />
                            </li>
                          ))
                        )}
                        {!isSearching && !isDebouncing && searchResults.length === 0 && searchQuery.trim() && (
                          <li className="text-gray-500 px-3">No results</li>
                        )}
                         {!isSearching && searchResults.map(album => {
                           const isAlreadyInWall = albums.some(a => a.id === album.id);
                           return (
                             <li key={album.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100">
                               <div className="flex items-center space-x-4">
                                 <img alt={`${album.name} album cover`} className="w-12 h-12 rounded-md object-cover" src={album.image} />
                                 <div>
                                   <p className="font-medium text-gray-900">{album.name}</p>
                                   <p className="text-sm text-gray-500">{album.artist}</p>
                                 </div>
                               </div>
                               <button
                                 type="button"
                                 aria-label={isAlreadyInWall ? `${album.name} already in wall` : `Add ${album.name}`}
                                 onClick={() => { if (!isAlreadyInWall) addAlbum(album); }}
                                 disabled={isAlreadyInWall || pendingAddId === album.id}
                                 className={`${
                                   isAlreadyInWall
                                     ? 'text-gray-400 cursor-not-allowed'
                                     : pendingAddId === album.id
                                       ? 'text-green-500 opacity-50 cursor-not-allowed'
                                       : 'text-green-500 hover:text-green-700'
                                 }`}
                               >
                                 <span className="material-icons">{isAlreadyInWall ? 'check_circle' : 'add_circle_outline'}</span>
                               </button>
                             </li>
                           );
                         })}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
       </main>
      </div>
      {showWsTooltip && (
        <div className="fixed bg-white border border-gray-200 rounded-lg shadow-xl p-4 z-50 min-w-64 pointer-events-none" style={{ top: '80px', right: '180px' }}>
          <div className="text-sm font-medium text-gray-900 mb-2">WebSocket Connection</div>
          <div className="space-y-2 text-xs text-gray-600">
            <div className="flex justify-between">
              <span>Server:</span>
              <span className="font-mono text-gray-800">ws://{window.location.hostname}:3002</span>
            </div>
            <div className="flex justify-between">
              <span>Status:</span>
              <span className={`font-medium ${wsConnected ? 'text-green-600' : 'text-red-600'}`}>
                {wsConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
          <div className="absolute -top-1 right-8 w-2 h-2 bg-white border-l border-t border-gray-200 rotate-45"></div>
        </div>
      )}
    </>
  );
}
