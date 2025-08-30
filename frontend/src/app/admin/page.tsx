'use client';

import { useEffect, useState, useRef, useCallback } from "react";
import Skeleton from "@/components/Skeleton";
import AlbumWall from "@/components/AlbumWall";
import { normalizeQueue } from "@/lib/queue";
import NowPlayingPanel from "@/components/NowPlayingPanel";

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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [upNext, setUpNext] = useState<import("@/lib/queue").MinimalTrack[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Album[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [pendingAddId, setPendingAddId] = useState<string | null>(null);
  const [apiBase, setApiBase] = useState('');
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

  useEffect(() => {
    const base = `http://${window.location.hostname}:3001`;
    setApiBase(base);
    // Check auth status on load
    fetch(`${base}/api/admin/status`)
      .then(res => res.json())
      .then(data => setIsLoggedIn(data.authenticated));
  }, []);

  useEffect(() => {
    if (isLoggedIn && apiBase) {
      // Try to seed playback status if the WS payload doesn't include it
      // Non-fatal if the endpoint doesn't exist
      fetch(`${apiBase}/api/playback/status`)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then((data) => {
          if (typeof data?.isPlaying === 'boolean') setIsPlaying(data.isPlaying);
        })
        .catch(() => {/* ignore */});

      fetch(`${apiBase}/api/albums`)
        .then(res => res.json())
        .then(setAlbums)
        .finally(() => setAlbumsLoading(false));
    }
  }, [isLoggedIn, apiBase]);

  // Fetch initial queue when logged in
  useEffect(() => {
    if (isLoggedIn && apiBase) {
      fetch(`${apiBase}/api/queue`)
        .then(res => res.json())
        .then((payload) => { setUpNext(normalizeQueue(payload)); setQueueLoaded(true); })
        .catch(() => { setUpNext([]); setQueueLoaded(true); });
    }
  }, [isLoggedIn, apiBase]);

  // Poll queue periodically as a fallback if WS doesn’t include it
  useEffect(() => {
    if (!isLoggedIn || !apiBase) return;
    const id = window.setInterval(() => {
      fetch(`${apiBase}/api/queue`)
        .then(res => res.json())
        .then((payload) => setUpNext(normalizeQueue(payload)))
        .catch(() => {/* ignore */});
    }, 30000); // Reduced from 5s to 30s
    return () => window.clearInterval(id);
  }, [isLoggedIn, apiBase]);

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

      ws.onopen = () => {
        console.log('Admin WebSocket connected');
        setWsConnected(true);
        reconnectAttempts = 0;

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

          console.log('Admin WS update:', data);
          if (data.nowPlaying) {
            console.log('Now playing:', data.nowPlaying.name, 'by', data.nowPlaying.artist);
          }
          if (Array.isArray?.(data.queue)) {
            console.log('Queue updated:', data.queue.map((t: any) => t.name).join(', '));
          }
          if (data.albums && Array.isArray(data.albums)) {
            console.log('Albums updated:', data.albums.length, 'albums');
            // Only update if the albums actually changed
            const albumsChanged = JSON.stringify(data.albums) !== JSON.stringify(albums);
            if (albumsChanged) {
              setAlbums(data.albums);
            }
          }
          // Only update nowPlaying if the payload explicitly includes the field and it's not undefined
          if ('nowPlaying' in data && data.nowPlaying !== undefined) {
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
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('Admin WebSocket disconnected, attempting reconnection...');
        setWsConnected(false);
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
    };
  }, [isLoggedIn]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${apiBase}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.redirect) {
      window.location.href = `${apiBase}${data.redirect}`;
    } else {
      alert('Invalid credentials');
    }
  };

  const performSearch = useCallback(async (query: string) => {
    if (!apiBase) return;
    const q = query.trim();
    if (!q) { setSearchResults([]); return; }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsSearching(true);
    try {
      const res = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Search failed');
      const results: Album[] = await res.json();
      // Use latest albums via ref so adding an album doesn't retrigger search
      const currentAlbums = albumsRef.current;
      setSearchResults(results.filter(album => !currentAlbums.some(a => a.id === album.id)));
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setSearchResults([]);
      }
    } finally {
      setIsSearching(false);
    }
  }, [apiBase]);

  useEffect(() => {
    // Keep albumsRef in sync with latest albums
    albumsRef.current = albums;
  }, [albums]);

  useEffect(() => {
    if (!apiBase) return;
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
  }, [searchQuery, apiBase]);

  const addAlbum = async (album: Album) => {
    setPendingAddId(album.id);
    try {
      await fetch(`${apiBase}/api/admin/albums`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(album)
      });
      setAlbums([...albums, album]);
      // Keep search term/results; just remove the added album from current results
      setSearchResults(searchResults.filter(a => a.id !== album.id));
      setPendingAddId(null);
    } catch (error) {
      console.error('Error adding album:', error);
      setPendingAddId(null);
    }
  };

  const removeAlbum = async (id: string) => {
    await fetch(`${apiBase}/api/admin/albums/${id}`, { method: 'DELETE' });
    setAlbums(albums.filter(a => a.id !== id));
  };

  const handlePlaybackAction = useCallback(async (action: string, endpoint: string) => {
    // Don't show loading for pause actions
    if (action !== 'pause') {
      setPlaybackActionLoading(action);
    }
    if (action !== 'pause') {
      setPlaybackUpdatePending(true);
    }

    // Optimistically update UI for play/pause
    if (action === 'play' || action === 'pause') {
      setIsPlaying(action === 'play');
    }

    try {
      const res = await fetch(`${apiBase}${endpoint}`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Playback ${action} failed`);
      }
      // Keep loading state until WebSocket confirms the update (except for pause)
      if (action !== 'pause') {
        setTimeout(() => {
          if (playbackActionLoading === action) {
            setPlaybackActionLoading(null);
            setPlaybackUpdatePending(false);
          }
        }, 2000); // Fallback timeout
      } else {
        // For pause, clear immediately since it's typically instant
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
  }, [apiBase]);

  const refreshPlaybackData = async () => {
    if (!apiBase) return;
    try {
      const [nowPlayingRes, queueRes] = await Promise.all([
        fetch(`${apiBase}/api/now-playing`),
        fetch(`${apiBase}/api/queue`)
      ]);

      if (nowPlayingRes.ok) {
        const nowPlayingData = await nowPlayingRes.json();
        setNowPlaying(nowPlayingData);
      }

      if (queueRes.ok) {
        const queueData = await queueRes.json();
        setUpNext(queueData);
      }

      setPlaybackLoaded(true);
      setQueueLoaded(true);
    } catch (error) {
      console.error('Error refreshing playback data:', error);
    }
  };

  // Handle album reorder coming from AlbumWall
  const handleReorder = async (updatedAlbums: Album[]) => {
    setAlbums(updatedAlbums);
    try {
      await fetch(`${apiBase}/api/admin/albums/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedAlbums)
      });
    } catch (error) {
      console.error('Error updating album positions:', error);
    }
  };



  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <form onSubmit={handleLogin} className="bg-gray-800 p-8 rounded">
          <h1 className="text-2xl font-bold mb-4">Admin Login</h1>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full p-2 mb-4 bg-gray-700 rounded"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-2 mb-4 bg-gray-700 rounded"
          />
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 p-2 rounded">
            Login
          </button>
        </form>
      </div>
    );
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
                  <span className="text-sm text-gray-600">
                    {wsConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
                <button
                  onClick={refreshPlaybackData}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-sm"
                  title="Refresh playback data"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-grow">
          <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
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

              {/* Now Playing panel */}
              <NowPlayingPanel
                nowPlaying={nowPlaying}
                isPlaying={isPlaying}
                playbackLoaded={playbackLoaded}
                playbackUpdatePending={playbackUpdatePending}
                playbackActionLoading={playbackActionLoading}
                onAction={handlePlaybackAction}
              />
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
                        {!isSearching && searchResults.map(album => (
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
                              aria-label={`Add ${album.name}`}
                              onClick={() => { addAlbum(album); }}
                              disabled={pendingAddId === album.id}
                              className={`text-green-500 hover:text-green-700 ${pendingAddId === album.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              <span className="material-icons">add_circle_outline</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
       </main>
      </div>
    </>
  );
}
