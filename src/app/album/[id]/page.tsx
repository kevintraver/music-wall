'use client';

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Skeleton from "@/components/shared/Skeleton";
import { normalizeQueue } from "@/lib/spotify/queue";
import { getTokens } from "@/lib/auth/tokens";
import { logger } from "@/lib/utils/logger";
import { getAlbums, setAlbumTracks, saveAlbumsToStorage } from "@/lib/utils/localStorage";

interface Track {
  id: string;
  name: string;
  duration_ms: number;
  artist?: string;
  image?: string;
}

interface Album {
  id: string;
  name: string;
  artist: string;
  image: string;
  position: number;
  tracks: Track[];
}

// Utility function to format duration
const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export default function AlbumPage() {
  const params = useParams();
  const router = useRouter();
  const albumId = params.id as string;
  const [album, setAlbum] = useState<Album | null>(null);
  const [apiBase, setApiBase] = useState('');
  const [message, setMessage] = useState('');
  const [queuedTrack, setQueuedTrack] = useState<string>('');
  const [upNext, setUpNext] = useState<import("@/lib/spotify/queue").MinimalTrack[]>([]);
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  const [albumLoading, setAlbumLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  useEffect(() => {
    const base = `http://${window.location.hostname}:3000`;
    setApiBase(base);

    const makeVariants = (id: string): string[] => {
      const variants = new Set<string>();
      variants.add(id);
      variants.add(id.replace(/I/g, 'l'));
      variants.add(id.replace(/l/g, 'I'));
      variants.add(id.replace(/O/g, '0'));
      variants.add(id.replace(/0/g, 'O'));
      variants.add(id.toLowerCase());
      variants.add(id.toUpperCase());
      return [...variants].filter(Boolean);
    };

    const resolveAlbumFromStorage = async () => {
      try {
        const list = await getAlbums();
        const variants = makeVariants(albumId);
        const found = list.find(a => variants.includes(a.id));
        if (!found) {
          // Do not fail immediately; wait for WebSocket snapshot or fallback
          // Show error only if nothing arrives after a short delay
          setTimeout(() => {
            setError(`Album ${albumId} not found in local storage`);
            setAlbumLoading(false);
          }, 4000);
          return;
        }

        // If tracks are already present, use them. Otherwise try Spotify.
        const initial: Album = {
          id: found.id,
          name: found.name,
          artist: (found as any).artist || '',
          image: (found as any).image || '',
          position: (found as any).position || 0,
          tracks: (found as any).tracks || [],
        };
        setAlbum(initial);

        if (!initial.tracks || initial.tracks.length === 0) {
          const { accessToken } = getTokens();
          if (accessToken) {
            try {
              const tracks = await fetchAllAlbumTracksFromSpotify(found.id, accessToken);
              // Persist back to localStorage for future loads
              setAlbumTracks(found.id, tracks);
              setAlbum(prev => prev ? { ...prev, tracks } : prev);
            } catch (e) {
              console.warn('Failed to fetch tracks from Spotify; continuing with empty list');
            }
          }
        }
      } catch (err: any) {
        console.error(err);
        setAlbum(null);
        setError(err.message || 'Failed to load album');
      } finally {
        // Keep loading true if album wasn't resolved to allow WS fallback
        setAlbumLoading(prev => (album ? false : prev));
      }
    };

    resolveAlbumFromStorage();
  }, [albumId]);

  async function fetchAllAlbumTracksFromSpotify(id: string, accessToken: string): Promise<Track[]> {
    const headers = { Authorization: `Bearer ${accessToken}` } as const;

    // Get album images/metadata if needed (not strictly necessary for tracks)
    // const albumRes = await fetch(`https://api.spotify.com/v1/albums/${id}`, { headers });

    let tracks: Track[] = [];
    let offset = 0;
    const limit = 50;
    for (;;) {
      const res = await fetch(`https://api.spotify.com/v1/albums/${id}/tracks?limit=${limit}&offset=${offset}&market=US`, { headers });
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '1', 10) * 1000;
        const jitter = retryAfter * 0.25 * (Math.random() * 2 - 1);
        const delay = Math.max(500, retryAfter + jitter);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (!res.ok) break;
      const data: any = await res.json();
      const items: any[] = Array.isArray(data?.items) ? data.items : [];
      tracks.push(...items.map((n: any) => ({
        id: n?.id,
        name: n?.name ?? '',
        duration_ms: n?.duration_ms ?? 0,
        artist: n?.artists?.[0]?.name,
        image: undefined,
      })));
      if (!data.next || items.length < limit) break;
      offset += limit;
      await new Promise(r => setTimeout(r, 150));
    }
    return tracks.filter(t => !!t.id);
  }

  useEffect(() => {
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
        logger.websocket('Album WebSocket connected');
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

          // Handle different message types
          switch (data.type) {
            case 'pong':
              // Heartbeat response - ignore
              return;

            case 'queue':
              // Queue update
              if (Array.isArray(data.payload)) {
                logger.info('Queue updated:', data.payload.length, 'tracks');
                setUpNext(normalizeQueue({ queue: data.payload }));
              }
              break;

            case 'playback':
              // Playback state update - could be useful for showing current track
              if (data.payload && data.payload.nowPlaying) {
                logger.playback('Now playing:', data.payload.nowPlaying.name);
                // Could add now playing display here if needed
              }
              break;

             case 'albums':
               // Albums update from WS; persist to localStorage and resolve current album if missing
               logger.info('Albums updated');
               const albumsUpdate = Array.isArray(data.payload) ? data.payload : (Array.isArray(data.albums) ? data.albums : []);
               if (Array.isArray(albumsUpdate) && albumsUpdate.length > 0) {
                 try { saveAlbumsToStorage(albumsUpdate); } catch {}
                 const match = albumsUpdate.find((a: any) => a?.id === albumId);
                 if (match) {
                   setAlbum((prev) => prev ? prev : {
                     id: match.id,
                     name: match.name,
                     artist: match.artist,
                     image: match.image,
                     position: (match as any).position ?? 0,
                     tracks: []
                   });
                   setError(null);
                   setAlbumLoading(false);
                 } else {
                   logger.info('Current album no longer exists, redirecting...');
                   router.push('/');
                 }
               }
               break;

            default:
              // Handle legacy messages or mixed updates
              if (data.queue || data.nowPlaying) {
                setUpNext(normalizeQueue(data));
              }
              break;
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        logger.websocket('Album WebSocket disconnected, attempting reconnection...');
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
        console.error('Album WebSocket error:', error);
      };
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (ws) ws.close();
    };
  }, []);

  // Seed queue initially from API in case WS message is delayed or lacks queue
  useEffect(() => {
    if (!apiBase) return;
    const { accessToken, refreshToken } = getTokens();
    const headers: Record<string, string> = {};
    if (accessToken) {
      headers['x-spotify-access-token'] = accessToken;
      if (refreshToken) headers['x-spotify-refresh-token'] = refreshToken;
    }
    fetch(`${apiBase}/api/queue`, { headers })
      .then(res => res.json())
      .then((payload) => setUpNext(normalizeQueue(payload)))
      .catch(() => {/* ignore */});
  }, [apiBase]);

  const queueTrack = async (trackId: string, retryCount = 0) => {
    if (pendingTrackId === trackId) return;
    const track = album?.tracks.find(t => t.id === trackId);
    if (!track) {
      setMessage('Track not found.');
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    setPendingTrackId(trackId);

    try {
      const { accessToken, refreshToken } = getTokens();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers['x-spotify-access-token'] = accessToken;
        if (refreshToken) headers['x-spotify-refresh-token'] = refreshToken;
      }
      const response = await fetch(`${apiBase}/api/queue`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ trackId })
      });

      if (response.ok) {
        setQueuedTrack(track.name);
        setMessage('✅ Track queued successfully!');

        // Optimistically reflect queued state until WS updates
        setUpNext(prev => (
          prev.some(t => t.id === trackId)
            ? prev
            : [
                ...prev,
                {
                  id: trackId,
                  name: track.name,
                  artist: track.artist || album?.artist || 'Unknown Artist',
                  image: track.image || album?.image,
                },
              ]
        ));

        // Clear success message after 3 seconds
        setTimeout(() => {
          setMessage('');
          setQueuedTrack('');
        }, 3000);

      } else if (response.status === 429 && retryCount < 2) {
        // Rate limited - retry after a delay
        const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff
        setMessage(`Rate limited, retrying in ${retryDelay / 1000}s...`);
        setTimeout(() => queueTrack(trackId, retryCount + 1), retryDelay);

      } else if (response.status === 401) {
        setMessage('❌ Queue unavailable. Ask the host to log into Admin.');
      } else {
        const errorData = await response.json().catch(() => ({}));
        setMessage(`❌ Failed to queue track: ${errorData.error || 'Unknown error'}`);
        setTimeout(() => setMessage(''), 5000);
      }

    } catch (error) {
      console.error('Queue track error:', error);

      if (retryCount < 2) {
        // Network error - retry
        const retryDelay = Math.pow(2, retryCount) * 1000;
        setMessage(`Connection error, retrying in ${retryDelay / 1000}s...`);
        setTimeout(() => queueTrack(trackId, retryCount + 1), retryDelay);
      } else {
        setMessage('❌ Failed to queue track. Please check your connection and try again.');
        setTimeout(() => setMessage(''), 5000);
      }
    } finally {
      if (retryCount >= 2) {
        setPendingTrackId(null);
      }
    }
  };

  if (albumLoading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4">
        <div className="max-w-md mx-auto">
          <div className="mt-8">
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="w-full h-10 rounded" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4">
        <div className="max-w-md mx-auto text-center">
          <div className="text-red-400 text-xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold mb-4">Album Not Available</h1>
          <p className="text-gray-400 mb-4">{error}</p>
          <p className="text-sm text-gray-500">This might be due to Spotify API rate limits or network issues.</p>
          <button 
            onClick={() => window.location.reload()} 
            className="mt-6 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4">
        <div className="max-w-md mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Album Not Found</h1>
          <p className="text-gray-400">The requested album could not be found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-lg mx-auto">
        {/* Album Header */}
        <div className="text-center mb-8">
          <img
            src={album.image}
            alt={album.name}
            width={250}
            height={250}
            className="rounded-xl mx-auto shadow-2xl"
          />
          <h1 className="text-3xl font-bold mt-6 mb-2">{album.name}</h1>
          <p className="text-xl text-gray-300 mb-4">{album.artist}</p>

          {/* Status Messages */}
          {message && (
            <div className="bg-green-600 text-white px-4 py-2 rounded-lg mb-4 inline-block">
              {message}
            </div>
          )}

          {queuedTrack && (
            <div className="bg-blue-600 text-white px-4 py-3 rounded-lg mb-4">
              <div className="text-sm opacity-90">Recently Queued</div>
              <div className="font-semibold">{queuedTrack}</div>
            </div>
          )}
        </div>

        {/* Track List */}
        <div className="bg-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold">Tracks</h2>
            <span className="text-sm text-gray-400">{album.tracks?.length || 0} songs</span>
          </div>

          <div className="space-y-3">
            {(album.tracks ?? []).map((track, index) => {
              const isQueued = upNext.some(t => t.id === track.id || t.uri === track.id);
              const isPending = pendingTrackId === track.id;
              const duration = track.duration_ms ? formatDuration(track.duration_ms) : '';

              return (
                <div
                  key={track.id}
                  className={`flex items-center justify-between p-4 rounded-lg transition-all ${
                    isQueued
                      ? 'bg-green-900/30 border border-green-500/30'
                      : 'bg-gray-700/50 hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center space-x-4 flex-1 min-w-0">
                    <div className="text-gray-400 text-sm w-6 text-right">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{track.name}</div>
                      {track.artist && track.artist !== album.artist && (
                        <div className="text-sm text-gray-400 truncate">{track.artist}</div>
                      )}
                    </div>
                    {duration && (
                      <div className="text-sm text-gray-400 ml-2">
                        {duration}
                      </div>
                    )}
                  </div>

                  <div className="ml-4">
                    {isQueued ? (
                      <div className="flex items-center space-x-2 text-green-400">
                        <span className="text-sm font-medium">Queued</span>
                        <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      </div>
                    ) : (
                      <button
                        onClick={() => queueTrack(track.id)}
                        disabled={isPending}
                        className={`px-4 py-2 rounded-lg font-medium transition-all ${
                          isPending
                            ? 'bg-gray-600 cursor-not-allowed text-gray-400'
                            : 'bg-green-600 hover:bg-green-700 text-white shadow-lg hover:shadow-xl'
                        }`}
                      >
                        {isPending ? (
                          <div className="flex items-center space-x-2">
                            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                            <span>Adding...</span>
                          </div>
                        ) : (
                          'Add to Queue'
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {(!album.tracks || album.tracks.length === 0) && (
            <div className="text-center py-8 text-gray-400">
              <div className="text-4xl mb-4">🎵</div>
              <div>No tracks available for this album</div>
            </div>
          )}
        </div>


      </div>
    </div>
  );
}
