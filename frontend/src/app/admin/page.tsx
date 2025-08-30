'use client';

import { useEffect, useState, useRef, useCallback } from "react";
import Skeleton from "@/components/Skeleton";
import { normalizeQueue } from "@/lib/queue";

interface Album {
  id: string;
  name: string;
  artist: string;
  image: string;
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
  const [pendingAddId, setPendingAddId] = useState<string | null>(null);
  const [apiBase, setApiBase] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const [albumsLoading, setAlbumsLoading] = useState(true);
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
    }, 5000);
    return () => window.clearInterval(id);
  }, [isLoggedIn, apiBase]);

  useEffect(() => {
    if (isLoggedIn) {
      const ws = new WebSocket(`ws://${window.location.hostname}:3002`);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Admin WS update:', data);
        if (data.nowPlaying) {
          console.log('Now playing:', data.nowPlaying.name, 'by', data.nowPlaying.artist);
        }
        if (data.queue && data.queue.length > 0) {
          console.log('Queue updated:', data.queue.map((t: any) => t.name).join(', '));
        }
        setNowPlaying(data.nowPlaying);
        // Fallback: if server doesn't include isPlaying, keep previous value
        if (typeof data.isPlaying === 'boolean') {
          setIsPlaying(data.isPlaying);
        }
        const normalized = normalizeQueue(data);
        if (normalized.length) setUpNext(normalized);
        setPlaybackLoaded(true);
        setQueueLoaded(true);
      };
      ws.onopen = () => {
        console.log('Admin WS connected');
        setWsConnected(true);
      };
      ws.onclose = () => {
        console.log('Admin WS disconnected');
        setWsConnected(false);
      };
      ws.onerror = () => {
        console.log('Admin WS error');
        setWsConnected(false);
      };
      return () => ws.close();
    }
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
      const results = await res.json();
      setSearchResults(results);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setSearchResults([]);
      }
    } finally {
      setIsSearching(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (!apiBase) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => performSearch(searchQuery), 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [searchQuery, apiBase, performSearch]);

  const addAlbum = async (album: Album) => {
    setPendingAddId(album.id);
    try {
      await fetch(`${apiBase}/api/admin/albums`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(album)
      });
      setAlbums([...albums, album]);
      setSearchResults(searchResults.filter(a => a.id !== album.id));
      // Clear search query and results after successful addition
      setSearchQuery('');
      setSearchResults([]);
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

  const handlePlaybackAction = async (action: string, endpoint: string) => {
    setPlaybackActionLoading(action);
    try {
      const res = await fetch(`${apiBase}${endpoint}`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Playback ${action} failed`);
      }
    } catch (error) {
      console.error(`Error ${action}:`, error);
      // Could add user notification here
    } finally {
      setPlaybackActionLoading(null);
    }
  };

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
              <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-md flex flex-col">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Now Playing</h2>
                <div className="flex-grow flex flex-col sm:flex-row items-center justify-center text-center bg-gray-800 text-white p-6 rounded-lg mb-4 gap-6">
                  {playbackLoaded ? (
                    nowPlaying ? (
                    <>
                      <img alt={`${nowPlaying.album} album cover`} className="w-48 h-48 rounded-lg shadow-lg" src={nowPlaying.image} />
                      <div className="flex-1 flex flex-col items-center text-center">
                        <p className="text-3xl font-bold">{nowPlaying.name}</p>
                        <p className="text-xl text-gray-300 mt-1">{nowPlaying.artist}</p>
                        <div className="flex items-center justify-center space-x-6 mt-6">
                           <button
                             type="button"
                             aria-label="Previous"
                             onClick={() => handlePlaybackAction('previous', '/api/playback/previous')}
                             disabled={playbackActionLoading === 'previous'}
                             className="bg-gray-700 text-white w-14 h-14 rounded-full hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                           >
                             {playbackActionLoading === 'previous' ? (
                               <span className="material-icons animate-spin text-2xl">autorenew</span>
                             ) : (
                               <span className="material-icons text-3xl">skip_previous</span>
                             )}
                           </button>
                          <button
                            type="button"
                            aria-label={isPlaying ? 'Pause' : 'Play'}
                            onClick={async () => {
                              const wasPlaying = isPlaying;
                              const action = wasPlaying ? 'pause' : 'play';
                              // Optimistically toggle UI state
                              setIsPlaying(!wasPlaying);
                              try {
                                const res = await fetch(`${apiBase}/api/playback/${action}`, { method: 'POST' });
                                if (!res.ok) throw new Error(`Playback ${action} failed`);
                              } catch (e) {
                                // Revert UI state on failure
                                setIsPlaying(wasPlaying);
                                console.error(e);
                              }
                            }}
                            className="bg-green-500 text-white w-16 h-16 rounded-full hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-green-500 flex items-center justify-center"
                          >
                            <span className="material-icons text-4xl">{isPlaying ? 'pause' : 'play_arrow'}</span>
                          </button>
                           <button
                             type="button"
                             aria-label="Next"
                             onClick={() => handlePlaybackAction('next', '/api/playback/next')}
                             disabled={playbackActionLoading === 'next'}
                             className="bg-gray-700 text-white w-14 h-14 rounded-full hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                           >
                             {playbackActionLoading === 'next' ? (
                               <span className="material-icons animate-spin text-2xl">autorenew</span>
                             ) : (
                               <span className="material-icons text-3xl">skip_next</span>
                             )}
                           </button>
                        </div>
                      </div>
                    </>
                    ) : (
                      <p className="text-xl">No track playing</p>
                    )
                  ) : (
                    <div className="w-full flex items-center justify-center gap-6">
                      <Skeleton className="w-48 h-48 rounded-lg" />
                      <div className="flex-1 max-w-sm">
                        <Skeleton className="w-3/4 h-7" />
                        <Skeleton className="w-1/2 h-5 mt-3" />
                        <div className="flex items-center justify-center space-x-6 mt-6">
                          <Skeleton className="w-14 h-14 rounded-full" />
                          <Skeleton className="w-16 h-16 rounded-full" />
                          <Skeleton className="w-14 h-14 rounded-full" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Wall (left) + Search (right) */}
            <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Wall left: 2 columns */}
              <div className="lg:col-span-2 bg-white pt-8 px-6 pb-6 rounded-xl shadow-md">
                <h2 className="text-2xl font-semibold text-gray-800 mb-6">Current Wall</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-5 gap-6">
                  {albumsLoading ? (
                    Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} className="group relative">
                        <Skeleton className="w-full h-auto rounded-lg aspect-square shadow-md" />
                        <div className="mt-3 text-center">
                          <Skeleton className="w-3/4 h-4 mx-auto" />
                        </div>
                      </div>
                    ))
                  ) : (
                    albums.map(album => (
                      <div key={album.id} className="group relative">
                        <img alt={`${album.name} album cover`} className="w-full h-auto rounded-lg object-cover aspect-square shadow-md" src={album.image} />
                        <button
                          onClick={() => removeAlbum(album.id)}
                          className="absolute top-2 right-2 bg-red-600 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white"
                        >
                          <span className="material-icons text-base">delete</span>
                        </button>
                        <div className="mt-3 text-center">
                          <p className="font-semibold text-gray-800 text-base leading-tight">{album.name}</p>
                          <p className="text-sm text-gray-500 mt-1">{album.artist}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
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
                        onClick={() => { setSearchQuery(''); setSearchResults([]); }}
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
                      <h3 className="text-lg font-medium text-gray-700 mb-3">Search Results</h3>
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
                        {!isSearching && searchResults.length === 0 && searchQuery.trim() && (
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
