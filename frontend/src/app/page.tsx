'use client';

import Image from "next/image";
import { useEffect, useState } from "react";
import Skeleton from "@/components/Skeleton";

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
  image?: string;
}

export default function Home() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [qrs, setQrs] = useState<{ [key: string]: string }>({});
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [upNext, setUpNext] = useState<Track[]>([]);
  const [apiBase, setApiBase] = useState('');
  const [albumsLoading, setAlbumsLoading] = useState(true);
  const [playbackLoaded, setPlaybackLoaded] = useState(false);

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
    const ws = new WebSocket(`ws://${window.location.hostname}:3002`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setNowPlaying(data.nowPlaying);
      setUpNext(data.queue);
      setPlaybackLoaded(true);
    };
    return () => ws.close();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white p-4 flex flex-col">
      <h1 className="text-4xl font-bold text-center mb-8">Song Wall</h1>
      <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
        {albumsLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center">
                <Skeleton className="w-[200px] h-[200px] rounded-lg" />
                <Skeleton className="w-3/4 h-4 mt-3" />
                <Skeleton className="w-1/2 h-3 mt-2" />
                <Skeleton className="w-[100px] h-[100px] mt-3" />
              </div>
            ))
          : albums.map(album => (
              <div key={album.id} className="flex flex-col items-center">
                 <img
                   src={album.image}
                   alt={album.name}
                   width={200}
                   height={200}
                   className="rounded-lg"
                 />
                <p className="text-center mt-2">{album.name}</p>
                <p className="text-center text-sm text-gray-400">{album.artist}</p>
                {qrs[album.id] ? (
                  <Image
                    src={qrs[album.id]}
                    alt="QR Code"
                    width={100}
                    height={100}
                    className="mt-2"
                  />
                ) : (
                  <Skeleton className="w-[100px] h-[100px] mt-2" />
                )}
              </div>
            ))}
      </div>
      <div className="mt-8">
        <div className="bg-gray-800 p-4 rounded mb-4">
          <h2 className="text-xl font-semibold mb-3">Now Playing</h2>
          {playbackLoaded ? (
            nowPlaying ? (
              <div className="flex items-center gap-3">
                {nowPlaying.image ? (
                  <img
                    src={nowPlaying.image}
                    alt={nowPlaying.name}
                    width={50}
                    height={50}
                    className="rounded"
                  />
                ) : (
                  <Skeleton className="w-[50px] h-[50px]" />
                )}
                <p>{nowPlaying.name} - {nowPlaying.artist}</p>
              </div>
            ) : (
              <p className="text-gray-300">No track playing</p>
            )
          ) : (
            <div className="flex items-center gap-3">
              <Skeleton className="w-[50px] h-[50px]" />
              <Skeleton className="w-48 h-4" />
            </div>
          )}
        </div>
        <div className="bg-gray-800 p-4 rounded">
          <h2 className="text-xl font-semibold mb-3">Up Next</h2>
          {playbackLoaded ? (
            upNext.length > 0 ? (
              <ul>
                {upNext.slice(0, 3).map(track => (
                  <li key={track.id}>{track.name} - {track.artist}</li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-300">Queue is empty</p>
            )
          ) : (
            <div className="space-y-2">
              <Skeleton className="w-2/3 h-4" />
              <Skeleton className="w-1/2 h-4" />
              <Skeleton className="w-3/4 h-4" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
