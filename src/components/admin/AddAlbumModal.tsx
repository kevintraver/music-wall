"use client";

import React, { useEffect, useRef, useState } from "react";

interface Album {
  id: string;
  name: string;
  artist: string;
  image: string;
  position: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onAddAlbum?: (album: Album) => void;
}

function AddAlbumModal({ open, onClose, onAddAlbum }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Album[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [pendingAddId, setPendingAddId] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const performSearch = async (query: string) => {
    const q = query.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Search failed');
      const results: Album[] = await res.json();
      setSearchResults(results);
    } catch (e) {
      console.error('Search error:', e);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddAlbum = async (album: Album) => {
    if (!onAddAlbum) return;

    setPendingAddId(album.id);
    try {
      await onAddAlbum(album);
      setSearchResults(prev => prev.filter(a => a.id !== album.id));
    } catch (error) {
      console.error('Error adding album:', error);
    } finally {
      setPendingAddId(null);
    }
  };

  // Automatic search with debouncing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (searchQuery.trim()) {
      debounceRef.current = setTimeout(() => {
        performSearch(searchQuery);
      }, 500);
    } else {
      setSearchResults([]);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setSearchResults([]);
      setIsSearching(false);
      setPendingAddId(null);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-album-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        className="relative bg-gray-800 w-full max-w-lg rounded-xl shadow-2xl p-6 mx-4 text-white"
      >
        <div className="flex items-start justify-between mb-4">
          <h2 id="add-album-title" className="text-xl font-semibold text-white">
            Add Album
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="space-y-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Search for albums..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-white placeholder-gray-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white w-6 h-6 flex items-center justify-center"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isSearching ? (
              <div className="text-center py-8 text-gray-400">
                Searching...
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-3">
                {searchResults.map((album) => (
                  <div key={album.id} className="flex items-center p-3 bg-gray-700 rounded-lg hover:bg-gray-600">
                    <img
                      src={album.image}
                      alt={`${album.name} album cover`}
                      className="w-12 h-12 rounded mr-3 object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white truncate">
                        {album.name}
                      </div>
                      <div className="text-sm text-gray-400 truncate">
                        {album.artist}
                      </div>
                    </div>
                    <button
                      onClick={() => handleAddAlbum(album)}
                      disabled={pendingAddId === album.id}
                      className="px-3 py-1 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {pendingAddId === album.id ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                ))}
              </div>
            ) : searchQuery && !isSearching ? (
              <div className="text-center py-8 text-gray-400">
                No results found
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default React.memo(AddAlbumModal);

