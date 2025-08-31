'use client';

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Skeleton from "@/components/Skeleton";
import { normalizeQueue } from "@/lib/queue";

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

export default function AlbumPage() {
  const params = useParams();
  const albumId = params.id as string;
  const [album, setAlbum] = useState<Album | null>(null);
  const [apiBase, setApiBase] = useState('');
  const [message, setMessage] = useState('');
  const [queuedTrack, setQueuedTrack] = useState<string>('');
  const [upNext, setUpNext] = useState<import("@/lib/queue").MinimalTrack[]>([]);
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  const [albumLoading, setAlbumLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  useEffect(() => {
    const base = `http://${window.location.hostname}:3001`;
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
        console.log('Album WebSocket connected');
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

          setUpNext(normalizeQueue(data));
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

  const queueTrack = async (trackId: string) => {
    if (pendingTrackId === trackId) return;
    const track = album?.tracks.find(t => t.id === trackId);
    if (!track) return;
    setPendingTrackId(trackId);
    try {
      const response = await fetch(`${apiBase}/api/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId })
      });
      if (response.ok) {
        setQueuedTrack(track.name);
        setMessage('Track queued successfully!');
        // Optimistically reflect queued state until WS updates
        setUpNext(prev => (
          prev.some(t => t.id === trackId)
            ? prev
            : [
                ...prev,
                {
                  id: trackId,
                  name: track.name,
                  artist: track.artist,
                  image: track.image,
                },
              ]
        ));
      } else {
        setMessage('Failed to queue track.');
      }
    } catch (error) {
      setMessage('Failed to queue track.');
    } finally {
      setPendingTrackId(null);
      setTimeout(() => setMessage(''), 3000);
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

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">


      <div className="max-w-md mx-auto">
         <img
           src={album.image}
           alt={album.name}
           width={300}
           height={300}
           className="rounded-lg mx-auto"
         />
        <h1 className="text-2xl font-bold text-center mt-4">{album.name}</h1>
        <p className="text-center text-gray-400">{album.artist}</p>
        {message && <p className="text-center text-green-400 mt-4">{message}</p>}
        {queuedTrack && (
          <div className="text-center mt-4">
            <h3 className="text-lg font-semibold">Queued</h3>
            <p>{queuedTrack}</p>
          </div>
        )}
        {/* Now Playing removed for QR queue page */}
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Tracks</h2>
          <ul className="space-y-2">
            {(album.tracks ?? []).map(track => {
              const isQueued = upNext.some(t => t.id === track.id);
              const isPending = pendingTrackId === track.id;
              return (
                <li key={track.id} className="flex justify-between items-center bg-gray-800 p-3 rounded">
                  <span>{track.name}</span>
                  {isQueued ? (
                    <span className="text-green-400 font-semibold">Queued</span>
                  ) : (
                    <button
                      onClick={() => queueTrack(track.id)}
                      disabled={isPending}
                      className={`${isPending ? 'bg-gray-600 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'} px-4 py-2 rounded`}
                    >
                      {isPending ? 'Queuing…' : 'Queue'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
