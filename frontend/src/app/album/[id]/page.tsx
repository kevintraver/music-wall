'use client';

import Image from "next/image";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Track {
  id: string;
  name: string;
  duration_ms: number;
}

interface Album {
  id: string;
  name: string;
  artist: string;
  image: string;
  tracks: Track[];
}

export default function AlbumPage() {
  const params = useParams();
  const albumId = params.id as string;
  const [album, setAlbum] = useState<Album | null>(null);
  const [apiBase, setApiBase] = useState('');

  useEffect(() => {
    const base = `http://${window.location.hostname}:3001`;
    setApiBase(base);
    fetch(`${base}/api/album/${albumId}`)
      .then(res => res.json())
      .then(setAlbum);
  }, [albumId]);

  const queueTrack = (trackId: string) => {
    fetch(`${apiBase}/api/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId })
    }).then(() => alert('Track queued!'));
  };

  if (!album) return <div>Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-md mx-auto">
        <Image
          src={album.image}
          alt={album.name}
          width={300}
          height={300}
          className="rounded-lg mx-auto"
        />
        <h1 className="text-2xl font-bold text-center mt-4">{album.name}</h1>
        <p className="text-center text-gray-400">{album.artist}</p>
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Tracks</h2>
          <ul className="space-y-2">
            {album.tracks.map(track => (
              <li key={track.id} className="flex justify-between items-center bg-gray-800 p-3 rounded">
                <span>{track.name}</span>
                <button
                  onClick={() => queueTrack(track.id)}
                  className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded"
                >
                  Queue
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}