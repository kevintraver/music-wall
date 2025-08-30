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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Album[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [apiBase, setApiBase] = useState('');

  useEffect(() => {
    const base = `http://${window.location.hostname}:3001`;
    setApiBase(base);
    // Check auth status on load
    fetch(`${base}/api/admin/status`)
      .then(res => res.json())
      .then(data => setIsLoggedIn(data.authenticated));
  }, []);

  useEffect(() => {
    if (isLoggedIn && apiBase) {
      fetch(`${apiBase}/api/albums`)
        .then(res => res.json())
        .then(setAlbums);
    }
  }, [isLoggedIn, apiBase]);

  useEffect(() => {
    if (isLoggedIn) {
      const ws = new WebSocket(`ws://${window.location.hostname}:3002`);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setNowPlaying(data.nowPlaying);
        setUpNext(data.queue);
      };
      return () => ws.close();
    }
  }, [isLoggedIn]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${apiBase}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.redirect) {
      window.location.href = `${apiBase}${data.redirect}`;
    } else {
      alert('Invalid credentials');
    }
  };

  useEffect(() => {
    if (!searchQuery || !apiBase) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    const timeout = setTimeout(async () => {
      const res = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(searchQuery)}`);
      const results = await res.json();
      setSearchResults(results);
      setShowDropdown(true);
    }, 300); // Debounce 300ms
    return () => clearTimeout(timeout);
  }, [searchQuery, apiBase]);

  const addAlbum = async (album: Album) => {
    await fetch(`${apiBase}/api/admin/albums`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(album)
    });
    setAlbums([...albums, album]);
    setSearchResults(searchResults.filter(a => a.id !== album.id));
  };

  const removeAlbum = async (id: string) => {
    await fetch(`${apiBase}/api/admin/albums/${id}`, { method: 'DELETE' });
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div>
          <h2 className="text-2xl font-semibold mb-4">Search & Add Albums</h2>
          <div className="mb-4 relative">
            <input
              type="text"
              placeholder="Search albums..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full p-2 bg-gray-700 rounded"
            />
            {showDropdown && searchResults.length > 0 && (
              <ul className="absolute top-full left-0 right-0 bg-gray-800 rounded mt-1 max-h-64 overflow-y-auto z-10">
                {searchResults.map(album => (
                  <li key={album.id} className="flex justify-between items-center p-3 hover:bg-gray-700 cursor-pointer" onClick={() => { addAlbum(album); setSearchQuery(''); setShowDropdown(false); }}>
                    <div className="flex items-center">
                      <img src={album.image} alt={album.name} width={40} height={40} className="rounded mr-2" />
                      <span>{album.name} - {album.artist}</span>
                    </div>
                    <button className="bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-sm">
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-semibold mb-4">Current Albums on Wall</h2>
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {albums.map(album => (
              <li key={album.id} className="flex justify-between items-center bg-gray-800 p-3 rounded">
                <div className="flex items-center">
                  <img src={album.image} alt={album.name} width={40} height={40} className="rounded mr-2" />
                  <span>{album.name} - {album.artist}</span>
                </div>
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
              <div className="flex items-center">
                <img src={nowPlaying.image} alt={nowPlaying.name} width={50} height={50} className="rounded mr-2" />
                <p>{nowPlaying.name} - {nowPlaying.artist}</p>
              </div>
            </div>
          )}
          <div className="bg-gray-800 p-4 rounded mb-4">
            <h3 className="font-semibold">Up Next</h3>
            <ul className="max-h-32 overflow-y-auto">
              {upNext.map(track => (
                <li key={track.id} className="flex items-center mb-2">
                  <img src={track.album} alt={track.name} width={30} height={30} className="rounded mr-2" />
                  <span>{track.name} - {track.artist}</span>
                </li>
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