'use client';

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

export default function AdminPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [upNext, setUpNext] = useState<Track[]>([]);
  const [newAlbumId, setNewAlbumId] = useState('');
  const [apiBase, setApiBase] = useState('');

  useEffect(() => {
    const base = `http://${window.location.hostname}:3001`;
    setApiBase(base);
  }, []);

  useEffect(() => {
    if (isLoggedIn && apiBase) {
      fetch(`${apiBase}/api/albums`)
        .then(res => res.json())
        .then(setAlbums);
      fetch(`${apiBase}/api/now-playing`)
        .then(res => res.json())
        .then(setNowPlaying);
      fetch(`${apiBase}/api/queue`)
        .then(res => res.json())
        .then(setUpNext);
    }
  }, [isLoggedIn, apiBase]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${apiBase}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok && data.redirect) {
      window.location.href = `${apiBase}${data.redirect}`;
    } else {
      alert('Invalid credentials');
    }
  };

  const addAlbum = async () => {
    // For prototype, just add a mock album
    const mockAlbum: Album = {
      id: newAlbumId,
      name: 'New Album',
      artist: 'New Artist',
      image: 'https://via.placeholder.com/200'
    };
    setAlbums([...albums, mockAlbum]);
    setNewAlbumId('');
  };

  const removeAlbum = (id: string) => {
    setAlbums(albums.filter(a => a.id !== id));
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <form onSubmit={handleLogin} className="bg-gray-800 p-8 rounded">
          <h1 className="text-2xl font-bold mb-4">Admin Login</h1>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full p-2 mb-4 bg-gray-700 rounded"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-2 mb-4 bg-gray-700 rounded"
          />
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 p-2 rounded">
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <h1 className="text-4xl font-bold mb-8">Admin Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Album Management</h2>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Album ID"
              value={newAlbumId}
              onChange={(e) => setNewAlbumId(e.target.value)}
              className="p-2 bg-gray-700 rounded mr-2"
            />
            <button onClick={addAlbum} className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded">
              Add Album
            </button>
          </div>
          <ul className="space-y-2">
            {albums.map(album => (
              <li key={album.id} className="flex justify-between items-center bg-gray-800 p-3 rounded">
                <span>{album.name} - {album.artist}</span>
                <button onClick={() => removeAlbum(album.id)} className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Queue Management</h2>
          {nowPlaying && (
            <div className="bg-gray-800 p-4 rounded mb-4">
              <h3 className="font-semibold">Now Playing</h3>
              <p>{nowPlaying.name} - {nowPlaying.artist}</p>
            </div>
          )}
          <div className="bg-gray-800 p-4 rounded mb-4">
            <h3 className="font-semibold">Up Next</h3>
            <ul>
              {upNext.map(track => (
                <li key={track.id}>{track.name} - {track.artist}</li>
              ))}
            </ul>
          </div>
           <div className="flex gap-2">
             <button
               onClick={() => fetch(`${apiBase}/api/playback/play`, { method: 'POST' })}
               className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded"
             >
               Play
             </button>
             <button
               onClick={() => fetch(`${apiBase}/api/playback/pause`, { method: 'POST' })}
               className="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 rounded"
             >
               Pause
             </button>
             <button
               onClick={() => fetch(`${apiBase}/api/playback/next`, { method: 'POST' })}
               className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
             >
               Skip
             </button>
           </div>
        </div>
      </div>
    </div>
  );
}