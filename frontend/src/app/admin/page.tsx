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
  image: string;
}

export default function AdminPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [upNext, setUpNext] = useState<Track[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Album[]>([]);
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

  // Fetch initial queue when logged in
  useEffect(() => {
    if (isLoggedIn && apiBase) {
      fetch(`${apiBase}/api/queue`)
        .then(res => res.json())
        .then(setUpNext)
        .catch(() => setUpNext([]));
    }
  }, [isLoggedIn, apiBase]);

  useEffect(() => {
    if (isLoggedIn) {
      const ws = new WebSocket(`ws://${window.location.hostname}:3002`);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('Admin WS update:', data);
        if (data.nowPlaying) {
          console.log('Now playing:', data.nowPlaying.name, 'by', data.nowPlaying.artist);
        }
        if (data.queue && data.queue.length > 0) {
          console.log('Queue updated:', data.queue.map(t => t.name).join(', '));
        }
        setNowPlaying(data.nowPlaying);
        setIsPlaying(data.isPlaying);
        setUpNext(data.queue);
      };
      ws.onopen = () => console.log('Admin WS connected');
      ws.onclose = () => console.log('Admin WS disconnected');
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
      return;
    }
    const timeout = setTimeout(async () => {
      const res = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(searchQuery)}`);
      const results = await res.json();
      setSearchResults(results);
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
    <>
      <div className="min-h-screen flex flex-col bg-gray-100">
        <header className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
            <h1 className="text-3xl font-bold leading-tight text-gray-900">Admin Dashboard</h1>
          </div>
        </header>
        <main className="flex-grow">
          <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Queue panel */}
              <div className="lg:col-span-1 bg-white p-6 rounded-xl shadow-md flex flex-col">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Queue</h2>
                <div className="flex-grow space-y-4">
                  <ul className="space-y-3">
                    {upNext.length === 0 && (
                      <li className="text-gray-500">Queue is empty</li>
                    )}
                    {upNext.map((t) => (
                      <li key={t.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100">
                        <div className="flex items-center space-x-4">
                          <span className="material-icons text-gray-400">drag_indicator</span>
                          {/* Image not available from queue API; keeping layout consistent */}
                          {/* <img alt={`${t.album} cover`} className="w-12 h-12 rounded-md object-cover" src={t.image} /> */}
                          <div>
                            <p className="font-medium text-gray-900">{t.name}</p>
                            <p className="text-sm text-gray-500">{t.artist}</p>
                          </div>
                        </div>
                        <button className="text-red-500 hover:text-red-700" title="Remove from queue" disabled>
                          <span className="material-icons">remove_circle_outline</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Now Playing panel */}
              <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-md flex flex-col">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Now Playing</h2>
                <div className="flex-grow flex flex-col sm:flex-row items-center justify-center text-center bg-gray-800 text-white p-6 rounded-lg mb-4 gap-6">
                  {nowPlaying ? (
                    <>
                      <img alt={`${nowPlaying.album} album cover`} className="w-48 h-48 rounded-lg shadow-lg" src={nowPlaying.image} />
                      <div className="flex-1 flex flex-col items-center text-center">
                        <p className="text-3xl font-bold">{nowPlaying.name}</p>
                        <p className="text-xl text-gray-300 mt-1">{nowPlaying.artist}</p>
                        <div className="flex items-center justify-center space-x-4 mt-6">
                          <button
                            onClick={() => fetch(`${apiBase}/api/playback/previous`, { method: 'POST' })}
                            className="bg-gray-700 text-white p-3 rounded-full hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white"
                          >
                            <span className="material-icons text-2xl">skip_previous</span>
                          </button>
                          <button
                            onClick={() => {
                              fetch(`${apiBase}/api/playback/${isPlaying ? 'pause' : 'play'}`, { method: 'POST' });
                            }}
                            className="bg-green-500 text-white p-4 rounded-full hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-green-500"
                          >
                            <span className="material-icons text-4xl">{isPlaying ? 'pause' : 'play_arrow'}</span>
                          </button>
                          <button
                            onClick={() => fetch(`${apiBase}/api/playback/next`, { method: 'POST' })}
                            className="bg-blue-500 text-white font-semibold py-3 px-6 rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500 flex items-center"
                          >
                            <span className="material-icons mr-1 text-lg">skip_next</span>
                            Next
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xl">No track playing</p>
                  )}
                </div>
              </div>
            </div>

            {/* Search & Add Albums full-width */}
            <div className="mt-8 bg-white p-6 rounded-xl shadow-md lg:col-span-3">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Search & Add Albums</h2>
              <div className="space-y-4">
                <div className="relative">
                  <span className="material-icons absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">search</span>
                    <input
                      type="text"
                      placeholder="Search albums..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 text-gray-900"
                    />
                </div>
                <div className="mt-4 border-t border-gray-200 pt-4">
                  <h3 className="text-lg font-medium text-gray-700 mb-3">Search Results</h3>
                  <ul className="space-y-3">
                    {searchResults.map(album => (
                      <li key={album.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer" onClick={() => { addAlbum(album); setSearchQuery(''); setSearchResults([]); }}>
                        <div className="flex items-center space-x-4">
                          <img alt={`${album.name} album cover`} className="w-12 h-12 rounded-md object-cover" src={album.image} />
                          <div>
                            <p className="font-medium text-gray-900">{album.name}</p>
                            <p className="text-sm text-gray-500">{album.artist}</p>
                          </div>
                        </div>
                        <button className="text-green-500 hover:text-green-700">
                          <span className="material-icons">add_circle_outline</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Current Wall */}
            <div className="mt-8 bg-white p-6 rounded-xl shadow-md">
              <h2 className="text-2xl font-semibold text-gray-800 mb-6">Current Wall</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                {albums.map(album => (
                  <div key={album.id} className="group relative">
                    <img alt={`${album.name} album cover`} className="w-full h-auto rounded-lg object-cover aspect-square shadow-md" src={album.image} />
                    <button
                      onClick={() => removeAlbum(album.id)}
                      className="absolute top-2 right-2 bg-red-600 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white"
                    >
                      <span className="material-icons text-base">delete</span>
                    </button>
                    <div className="mt-2 text-center">
                      <p className="font-semibold text-gray-800 truncate">{album.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
       </main>
      </div>
    </>
  );
}
