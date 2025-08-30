'use client';

import Image from "next/image";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Skeleton from "@/components/Skeleton";

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
  const [upNext, setUpNext] = useState<{ id: string }[]>([]);
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  const [albumLoading, setAlbumLoading] = useState(true);
  const [playbackLoaded, setPlaybackLoaded] = useState(false);

  useEffect(() => {
    const base = `http://${window.location.hostname}:3001`;
    setApiBase(base);
    fetch(`${base}/api/album/${albumId}`)
      .then(res => res.json())
      .then(setAlbum)
      .finally(() => setAlbumLoading(false));
  }, [albumId]);

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3002`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setNowPlaying(data.nowPlaying);
      setUpNext(data.queue || []);
      setPlaybackLoaded(true);
    };
    return () => ws.close();
  }, []);

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
        setUpNext(prev => (prev.some(t => t.id === trackId) ? prev : [...prev, { id: trackId }]));
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

  if (albumLoading || !album) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-4">
        <div className="max-w-md mx-auto">
          <Skeleton className="w-[300px] h-[300px] mx-auto rounded-lg" />
          <Skeleton className="w-2/3 h-6 mt-4 mx-auto" />
          <Skeleton className="w-1/3 h-4 mt-2 mx-auto" />
          <div className="mt-8">
            <Skeleton className="w-1/2 h-5 mb-4" />
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
        <div className="text-center mt-4">
          <h3 className="text-lg font-semibold">Now Playing</h3>
          {playbackLoaded ? (
            nowPlaying ? (
              <p>{nowPlaying.name} - {nowPlaying.artist}</p>
            ) : (
              <p className="text-gray-400">No track playing</p>
            )
          ) : (
            <div className="flex items-center justify-center gap-3 mt-2">
              <Skeleton className="w-10 h-10" />
              <Skeleton className="w-40 h-4" />
            </div>
          )}
        </div>
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Tracks</h2>
          <ul className="space-y-2">
            {album.tracks.map(track => {
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
