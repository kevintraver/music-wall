'use client';


import { useEffect, useState } from "react";
import Skeleton from "@/components/Skeleton";
import { normalizeQueue } from "@/lib/queue";
import ResponsiveAlbumGrid from "@/components/ResponsiveAlbumGrid";

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
  image?: string;
}

export default function Home() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [qrs, setQrs] = useState<{ [key: string]: string }>({});
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [upNext, setUpNext] = useState<import("@/lib/queue").MinimalTrack[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(true);
  const [playbackLoaded, setPlaybackLoaded] = useState(false);
  const [queueLoaded, setQueueLoaded] = useState(false);


  useEffect(() => {
    fetch('/api/albums')
      .then(res => res.json())
      .then(setAlbums)
      .finally(() => setAlbumsLoading(false));
  }, []);

  useEffect(() => {
    albums.forEach(album => {
      fetch(`/api/qr/${album.id}`)
        .then(res => res.json())
        .then(data => {
          setQrs(prev => ({ ...prev, [album.id]: data.qr }));
        });
    });
  }, [albums]);

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
        console.log('WebSocket connected');
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

          console.log('📨 WS message received:', data);

          // Validate message structure
          if (typeof data !== 'object' || data === null) {
            console.warn('Invalid WebSocket message format');
            return;
          }

          // Handle different message types to avoid cross-contamination
          const messageType = data.type || 'mixed';
          
          // Albums-only updates (e.g., from reordering)
          if (messageType === 'albums' || (data.albums && Array.isArray(data.albums) && !('nowPlaying' in data) && !('queue' in data))) {
            setAlbums(data.albums);
            return; // Don't process other fields for albums-only updates
          }
          
          // Playback-only updates (e.g., from play/pause/skip)
          if (messageType === 'playback' || ('nowPlaying' in data || 'queue' in data)) {
            // Only update nowPlaying if the payload explicitly includes the field
            if ('nowPlaying' in data) {
              console.log('🎵 Updating now playing:', data.nowPlaying?.name || 'None');
              setNowPlaying(data.nowPlaying);
            }
            // Only update queue if it's explicitly included in the message
            if ('queue' in data) {
              const normalized = normalizeQueue(data);
              console.log('📋 Updating queue:', normalized.length, 'tracks');
              setUpNext(normalized);
            }
            setPlaybackLoaded(true);
            setQueueLoaded(true);
            return;
          }
          
          // Mixed updates (fallback for legacy messages that contain everything)
          if (messageType === 'mixed') {
            if (data.albums && Array.isArray(data.albums)) {
              setAlbums(data.albums);
            }
            // Only update nowPlaying if it's explicitly provided
            if ('nowPlaying' in data) {
              setNowPlaying(data.nowPlaying);
            }
            // Only update queue if it's explicitly included in the message
            if ('queue' in data) {
              const normalized = normalizeQueue(data);
              setUpNext(normalized);
            }
            setPlaybackLoaded(true);
            setQueueLoaded(true);
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected, attempting reconnection...');
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
        console.error('WebSocket error:', error);
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
    fetch('/api/queue')
      .then(res => res.json())
      .then((payload) => { setUpNext(normalizeQueue(payload)); setQueueLoaded(true); })
      .catch(() => setQueueLoaded(true));
  }, []);

  // Poll queue as fallback if WS doesn’t include it continuously
  useEffect(() => {
    const pollingInterval = parseInt(process.env.NEXT_PUBLIC_QUEUE_POLLING_INTERVAL || '3000');
    const id = window.setInterval(() => {
      fetch('/api/queue')
        .then(res => res.json())
        .then((payload) => setUpNext(normalizeQueue(payload)))
        .catch(() => {/* ignore */});
    }, pollingInterval);
    return () => window.clearInterval(id);
  }, []);

  // Poll albums periodically to ensure sync with admin changes
  useEffect(() => {
    const pollingInterval = parseInt(process.env.NEXT_PUBLIC_ALBUMS_POLLING_INTERVAL || '2000');
    const id = window.setInterval(() => {
      fetch('/api/albums')
        .then(res => res.json())
        .then((albumsData) => setAlbums(albumsData))
        .catch(() => {/* ignore */});
    }, pollingInterval);
    return () => window.clearInterval(id);
  }, []);



  return (
    <div className="h-screen bg-black text-white px-8 lg:px-10 pt-10 pb-6 flex flex-col overflow-hidden">


      {/* Album Grid (auto-fits without bumping bottom) */}
      <div className="flex-1 min-h-0 overflow-hidden px-0 mb-8">
        <ResponsiveAlbumGrid albums={albums} qrs={qrs} albumsLoading={albumsLoading} />
      </div>

      {/* Now Playing and Up Next Layout */}
      <div className="shrink-0 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Now Playing - Left Side (2/3 width) */}
        <div className="lg:col-span-2 bg-gray-800 rounded-2xl p-5 flex flex-col">
          <h2 className="text-lg font-bold mb-3 text-gray-300 tracking-wider text-center">Now Playing</h2>
          {playbackLoaded ? (
            nowPlaying ? (
              <div className="flex flex-col items-center flex-grow text-center min-h-[clamp(12rem,24vh,16rem)]">
                {nowPlaying.image ? (
                  <img
                    src={nowPlaying.image}
                    alt={nowPlaying.name}
                    className="w-[clamp(6rem,16vh,12rem)] h-[clamp(6rem,16vh,12rem)] rounded-lg shadow-lg object-cover"
                  />
                ) : (
                  <Skeleton className="w-[clamp(6rem,16vh,12rem)] h-[clamp(6rem,16vh,12rem)] rounded-lg" />
                )}
                <div className="mt-6">
                  <h3 className="text-2xl font-bold truncate max-w-[90vw] lg:max-w-[60vw]">
                    {nowPlaying.name}
                  </h3>
                  <p className="text-sm text-gray-400 mt-1">{nowPlaying.artist}</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center flex-grow text-center justify-center min-h-[clamp(12rem,24vh,16rem)]">
                <Skeleton className="w-[clamp(6rem,16vh,12rem)] h-[clamp(6rem,16vh,12rem)] rounded-lg" />
                <div className="mt-6 w-[min(16rem,60vw)]">
                  <Skeleton className="h-7 w-3/4 mx-auto mb-2" />
                  <Skeleton className="h-4 w-1/2 mx-auto" />
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center flex-grow text-center justify-center min-h-[clamp(12rem,24vh,16rem)]">
              <Skeleton className="w-[clamp(6rem,16vh,12rem)] h-[clamp(6rem,16vh,12rem)] rounded-lg" />
              <div className="mt-6 w-[min(16rem,60vw)]">
                <Skeleton className="h-7 w-3/4 mx-auto mb-2" />
                <Skeleton className="h-4 w-1/2 mx-auto" />
              </div>
            </div>
          )}
        </div>

        {/* Up Next - Right Side (1/3 width) */}
        <div className="bg-gray-800 rounded-2xl p-5 flex flex-col">
          <h2 className="text-lg font-bold mb-3 text-gray-300 tracking-wider text-center">Up Next</h2>
          <div className="flex-grow flex flex-col justify-center">
            {queueLoaded ? (
              upNext.length > 0 ? (
                <div className="flex items-center space-x-3 p-2 rounded-lg h-20">
                  {upNext[0]?.image ? (
                    <img
                      src={upNext[0].image!}
                      alt={`Album art for the next song in the queue`}
                      className="w-20 h-20 rounded-md object-cover"
                    />
                  ) : (
                    <Skeleton className="w-20 h-20 rounded-md" />
                  )}
                  <div className="flex-grow min-w-0">
                    <p className="font-semibold text-base truncate">{upNext[0].name}</p>
                    <p className="text-sm text-gray-400 truncate">{upNext[0].artist}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-20 rounded-lg">
                  <p className="text-gray-300 text-sm">Queue is empty</p>
                </div>
              )
            ) : (
              <div className="flex items-center space-x-3 p-2 rounded-lg h-20">
                <Skeleton className="w-20 h-20 rounded-md" />
                <div className="flex-grow">
                  <Skeleton className="h-5 w-28 mb-2" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
