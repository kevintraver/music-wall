'use client';

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Skeleton from "@/components/shared/Skeleton";
import { normalizeQueue } from "@/lib/spotify/queue";
import { logger } from "@/lib/utils/logger";

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
    const fetchOnce = async (id: string) => {
      const res = await fetch(`${base}/api/album/${id}`);
      if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch {}
        try { console.error('Album fetch failed', { id, status: res.status, statusText: res.statusText, body }); } catch {}
        return null;
      }
      try { return await res.json(); } catch { return null; }
    };

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

    const tryFetchWithHeuristics = async () => {
      // 1) Try exact id
      let data = await fetchOnce(albumId);
      if (!data) {
        // 2) Heuristic fallbacks for potential QR casing/character confusion
        const variants = makeVariants(albumId);
        for (const v of variants) {
          if (v === albumId) continue;
          data = await fetchOnce(v);
          if (data) {
            try { console.warn('Album resolved via fallback id variant', { original: albumId, used: v }); } catch {}
            break;
          }
        }
      }
      if (!data) {
        // 3) As a last resort, fetch album list and try to match by variants
        try {
          const res = await fetch(`${base}/api/albums`);
          if (res.ok) {
            const list = await res.json();
            const candidates = makeVariants(albumId);
            const found = (list || []).find((a: any) => candidates.includes(a?.id));
            if (found?.id) {
              const retry = await fetchOnce(found.id);
              if (retry) {
                try { console.warn('Album resolved via /api/albums lookup', { original: albumId, used: found.id }); } catch {}
                data = retry;
              }
            }
          }
        } catch {}
      }
      return data;
    };

    tryFetchWithHeuristics()
      .then((data) => {
        if (!data) throw new Error(`Failed to load album ${albumId}`);
        if (data.error) throw new Error(data.error);
        try { console.debug('Album API payload received', data); } catch {}
        // Normalize possible backend shapes for album + tracks
        const root = data?.album ? data.album : data;
        const pickList = (d: any): any[] | null => {
          if (!d) return null;
          if (Array.isArray(d.tracks)) return d.tracks;
          if (Array.isArray(d?.tracks?.items)) return d.tracks.items;
          if (Array.isArray(d?.items)) return d.items;
          return null;
        };

        const rawList = pickList(root) ?? pickList(data) ?? [];
        const tracks: Track[] = (rawList as any[]).map((t: any) => {
          const n = t?.track ?? t; // some APIs nest under `track`
          return {
            id: n?.id ?? n?.track_id ?? n?.uri ?? '',
            name: n?.name ?? n?.title ?? n?.track_name ?? '',
            duration_ms: n?.duration_ms ?? n?.duration ?? 0,
            artist: n?.artist ?? n?.artist_name ?? n?.artists?.[0]?.name,
            image: n?.image ?? n?.album_art ?? n?.album?.images?.[0]?.url,
          } as Track;
        }).filter((t: Track) => !!t.id);

        const sanitized: Album = {
          id: root?.id ?? albumId,
          name: root?.name ?? '',
          artist: root?.artist ?? root?.artists?.[0]?.name ?? '',
          image: root?.image ?? root?.images?.[0]?.url ?? '',
          position: root?.position ?? 0,
          tracks,
        };
        if (!tracks.length) {
          try { console.warn('No tracks derived from album payload for id', albumId); } catch {}
        }
        setAlbum(sanitized);
      })
      .catch((err) => {
        console.error(err);
        setAlbum(null);
        setError(err.message || "Failed to load album");
      })
      .finally(() => setAlbumLoading(false));
  }, [albumId]);

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
                console.log('🎵 Now playing:', data.payload.nowPlaying.name);
                // Could add now playing display here if needed
              }
              break;

             case 'albums':
               // Album updates - might affect the current album
               console.log('💿 Albums updated');
               // Check if current album still exists or position changed
               if (Array.isArray(data.payload)) {
                 const currentAlbum = data.payload.find((album: any) => album.id === albumId);
                 if (!currentAlbum) {
                   console.log('Current album no longer exists, redirecting...');
                   router.push('/');
                 }
               } else if (Array.isArray(data.albums)) {
                 const currentAlbum = data.albums.find((album: any) => album.id === albumId);
                 if (!currentAlbum) {
                   console.log('Current album no longer exists, redirecting...');
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
        console.log('Album WebSocket disconnected, attempting reconnection...');
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
    fetch(`${apiBase}/api/queue`)
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
      const response = await fetch(`${apiBase}/api/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        setMessage('❌ Authentication required. Please refresh the page.');
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
    return <div>Loading album...</div>;

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
              const isQueued = upNext.some(t => t.id === track.id);
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

        {/* Queue Preview */}
        {upNext.length > 0 && (
          <div className="mt-6 bg-gray-800 rounded-xl p-4">
            <h3 className="text-lg font-semibold mb-3">Up Next</h3>
            <div className="space-y-2">
              {upNext.slice(0, 3).map((track, index) => (
                <div key={track.id} className="flex items-center space-x-3 text-sm">
                  <div className="w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center text-xs">
                    {index + 1}
                  </div>
                  <div className="flex-1 truncate">
                    <div className="font-medium">{track.name}</div>
                    <div className="text-gray-400">{track.artist}</div>
                  </div>
                </div>
              ))}
              {upNext.length > 3 && (
                <div className="text-sm text-gray-400 text-center pt-2">
                  +{upNext.length - 3} more songs
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
