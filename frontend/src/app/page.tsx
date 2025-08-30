'use client';

import Image from "next/image";
import { useEffect, useState } from "react";
import Skeleton from "@/components/Skeleton";
import { normalizeQueue } from "@/lib/queue";

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
  const [apiBase, setApiBase] = useState('');
  const [albumsLoading, setAlbumsLoading] = useState(true);
  const [playbackLoaded, setPlaybackLoaded] = useState(false);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    const base = `http://${window.location.hostname}:3001`;
    setApiBase(base);
    fetch(`${base}/api/albums`)
      .then(res => res.json())
      .then(setAlbums)
      .finally(() => setAlbumsLoading(false));
  }, []);

  useEffect(() => {
    if (!apiBase) return;
    albums.forEach(album => {
      fetch(`${apiBase}/api/qr/${album.id}`)
        .then(res => res.json())
        .then(data => {
          setQrs(prev => ({ ...prev, [album.id]: data.qr }));
        });
    });
  }, [albums, apiBase]);

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

          if (data.albums && Array.isArray(data.albums)) {
            setAlbums(data.albums);
          }
          setNowPlaying(data.nowPlaying);
          const normalized = normalizeQueue(data);
          if (normalized.length) setUpNext(normalized);
          setPlaybackLoaded(true);
          setQueueLoaded(true);
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
    if (!apiBase) return;
    fetch(`${apiBase}/api/queue`)
      .then(res => res.json())
      .then((payload) => { setUpNext(normalizeQueue(payload)); setQueueLoaded(true); })
      .catch(() => setQueueLoaded(true));
  }, [apiBase]);

  // Poll queue as fallback if WS doesn’t include it continuously
  useEffect(() => {
    if (!apiBase) return;
    const id = window.setInterval(() => {
      fetch(`${apiBase}/api/queue`)
        .then(res => res.json())
        .then((payload) => setUpNext(normalizeQueue(payload)))
        .catch(() => {/* ignore */});
    }, 30000); // Reduced from 5s to 30s
    return () => window.clearInterval(id);
  }, [apiBase]);

  // Poll albums periodically to ensure sync with admin changes
  useEffect(() => {
    if (!apiBase) return;
    const id = window.setInterval(() => {
      fetch(`${apiBase}/api/albums`)
        .then(res => res.json())
        .then((albumsData) => setAlbums(albumsData))
        .catch(() => {/* ignore */});
    }, 10000); // Refresh albums every 10 seconds
    return () => window.clearInterval(id);
  }, [apiBase]);



  return (
    <div className="h-screen bg-black text-white px-8 pt-8 pb-6 flex flex-col overflow-hidden">
      {/* Connection status indicator */}
      <div className="fixed top-4 right-4 z-50">
        <div className={`w-3 h-3 rounded-full shadow-lg ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
      </div>

      {/* Album Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-14 mb-14 mx-6">
        {albumsLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center">
                <Skeleton className="w-[140px] h-[140px] rounded-lg" />
                <Skeleton className="w-3/4 h-4 mt-2" />
                <Skeleton className="w-1/2 h-3 mt-1" />
                <Skeleton className="w-[70px] h-[70px] mt-2" />
              </div>
            ))
          : [...albums].sort((a, b) => a.position - b.position).map(album => (
              <div key={album.id} className="flex flex-col items-center">
                 <img
                   src={album.image}
                   alt={album.name}
                   width={140}
                   height={140}
                   className="rounded-lg"
                 />
                <p className="text-center mt-2 text-sm">{album.name}</p>
                <p className="text-center text-xs text-gray-400">{album.artist}</p>
                {qrs[album.id] ? (
                  <Image
                    src={qrs[album.id]}
                    alt="QR Code"
                    width={70}
                    height={70}
                    className="mt-2"
                  />
                ) : (
                  <Skeleton className="w-[70px] h-[70px] mt-2" />
                )}
              </div>
            ))}
      </div>

      {/* Now Playing and Up Next Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-0">
        {/* Now Playing - Left Side (2/3 width) */}
        <div className="lg:col-span-2 flex flex-col">
          <div className="bg-gray-800 p-3 rounded-lg flex-1 flex flex-col justify-center">
            <h2 className="text-lg font-bold mb-2 mt-1 text-center">Now Playing</h2>
            {playbackLoaded ? (
              nowPlaying ? (
                <div className="flex items-center gap-4 justify-center">
                  {nowPlaying.image ? (
                    <img
                      src={nowPlaying.image}
                      alt={nowPlaying.name}
                      width={110}
                      height={110}
                      className="rounded-lg shadow-lg"
                    />
                  ) : (
                    <Skeleton className="w-[110px] h-[110px] rounded-lg" />
                  )}
                  <div className="flex-1 text-center">
                    <p className="text-base font-bold mb-1">{nowPlaying.name}</p>
                    <p className="text-sm text-gray-300">{nowPlaying.artist}</p>
                  </div>
                </div>
              ) : (
                <div className="py-4">
                  <p className="text-sm text-gray-300">No track playing</p>
                </div>
              )
              ) : (
                <div className="flex items-center gap-4 justify-center">
                  <Skeleton className="w-[110px] h-[110px] rounded-lg" />
                  <div className="flex-1 text-center">
                    <Skeleton className="w-28 h-3 mb-1" />
                    <Skeleton className="w-20 h-3" />
                  </div>
                </div>
              )}
          </div>
        </div>

        {/* Up Next - Right Side (1/3 width) */}
        <div className="lg:col-span-1 flex flex-col">
          <div className="bg-gray-800 p-3 rounded-lg flex-1 flex flex-col">
            <h2 className="text-lg font-bold mb-2 mt-1 text-center">Up Next</h2>
            <div className="flex-1 overflow-hidden">
              {queueLoaded ? (
                upNext.length > 0 ? (
                  <div className="flex items-center justify-center flex-1">
                    {upNext.length > 0 ? (
                      <div className="text-center">
                        <p className="font-medium text-sm mb-1">{upNext[0].name}</p>
                        <p className="text-xs text-gray-400">{upNext[0].artist}</p>
                      </div>
                    ) : (
                      <p className="text-gray-300 text-sm">Queue is empty</p>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-300 text-center py-3 text-sm">Queue is empty</p>
                )
              ) : (
                <div className="flex items-center justify-center flex-1">
                  <div className="text-center">
                    <Skeleton className="w-28 h-3 mb-1 mx-auto" />
                    <Skeleton className="w-20 h-3 mx-auto" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
