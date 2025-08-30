'use client';

import Image from "next/image";
import { useEffect, useState } from "react";

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
}

export default function Home() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [qrs, setQrs] = useState<{ [key: string]: string }>({});
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [upNext, setUpNext] = useState<Track[]>([]);

  useEffect(() => {
    fetch('http://localhost:3001/api/albums')
      .then(res => res.json())
      .then(setAlbums);
  }, []);

  useEffect(() => {
    albums.forEach(album => {
      fetch(`http://localhost:3001/api/qr/${album.id}`)
        .then(res => res.json())
        .then(data => {
          setQrs(prev => ({ ...prev, [album.id]: data.qr }));
        });
    });
  }, [albums]);

  useEffect(() => {
    const poll = () => {
      fetch('http://localhost:3001/api/now-playing')
        .then(res => res.json())
        .then(setNowPlaying);
      fetch('http://localhost:3001/api/queue')
        .then(res => res.json())
        .then(setUpNext);
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-black text-white p-4 flex flex-col">
      <h1 className="text-4xl font-bold text-center mb-8">Song Wall</h1>
      <div className="flex-1 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
        {albums.map(album => (
          <div key={album.id} className="flex flex-col items-center">
            <Image
              src={album.image}
              alt={album.name}
              width={200}
              height={200}
              className="rounded-lg"
            />
            <p className="text-center mt-2">{album.name}</p>
            <p className="text-center text-sm text-gray-400">{album.artist}</p>
            {qrs[album.id] && (
              <Image
                src={qrs[album.id]}
                alt="QR Code"
                width={100}
                height={100}
                className="mt-2"
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-8">
        {nowPlaying && (
          <div className="bg-gray-800 p-4 rounded mb-4">
            <h2 className="text-xl font-semibold">Now Playing</h2>
            <p>{nowPlaying.name} - {nowPlaying.artist}</p>
          </div>
        )}
        {upNext.length > 0 && (
          <div className="bg-gray-800 p-4 rounded">
            <h2 className="text-xl font-semibold">Up Next</h2>
            <ul>
              {upNext.slice(0, 3).map(track => (
                <li key={track.id}>{track.name} - {track.artist}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
