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
  const [message, setMessage] = useState('');
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [queuedTrack, setQueuedTrack] = useState<string>('');

  useEffect(() => {
    const base = `http://${window.location.hostname}:3001`;
    setApiBase(base);
    fetch(`${base}/api/album/${albumId}`)
      .then(res => res.json())
      .then(setAlbum);
  }, [albumId]);

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3002`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setNowPlaying(data.nowPlaying);
      setUpNext(data.queue || []);
    };
    return () => ws.close();
  }, []);

  const queueTrack = (trackId: string) => {
    console.log('Queue button clicked for track:', trackId);
    console.log('API base:', apiBase);
    const track = album?.tracks.find(t => t.id === trackId);
    if (!track) {
      console.error('Track not found:', trackId);
      return;
    }
    console.log('Found track:', track.name);
    fetch(`${apiBase}/api/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId })
    }).then(response => {
      console.log('Queue response status:', response.status);
      if (response.ok) {
        setQueuedTrack(track.name);
        setMessage('Track queued successfully!');
        setTimeout(() => setMessage(''), 3000);
      } else {
        console.error('Queue failed with status:', response.status);
        setMessage('Failed to queue track.');
        setTimeout(() => setMessage(''), 3000);
      }
    }).catch(error => {
      console.error('Queue fetch error:', error);
      setMessage('Failed to queue track.');
      setTimeout(() => setMessage(''), 3000);
    });
  };

  if (!album) return <div>Loading...</div>;

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
        {nowPlaying && (
          <div className="text-center mt-4">
            <h3 className="text-lg font-semibold">Now Playing</h3>
            <p>{nowPlaying.name} - {nowPlaying.artist}</p>
          </div>
        )}
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Tracks</h2>
          <ul className="space-y-2">
            {album.tracks.map(track => {
              const isQueued = upNext.some(t => t.id === track.id);
              return (
                <li key={track.id} className="flex justify-between items-center bg-gray-800 p-3 rounded">
                  <span>{track.name}</span>
                  {isQueued ? (
                    <span className="text-green-400 font-semibold">Queued</span>
                  ) : (
                    <button
                      onClick={() => queueTrack(track.id)}
                      className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded"
                    >
                      Queue
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