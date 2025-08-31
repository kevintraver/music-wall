"use client";

import React, { useMemo } from "react";

interface Album {
  id: string;
  name: string;
  artist: string;
  image: string;
  position: number;
}

type Props = {
  albums: Album[];
  albumsLoading: boolean;
  onRemove: (id: string) => void | Promise<void>;
};

export default function AlbumWall({ albums, albumsLoading, onRemove }: Props) {
  // Ensure unique albums by id to avoid React key warnings when duplicates slip in
  const uniqueAlbums = useMemo(() => {
    const map = new Map<string, Album>();
    for (const a of albums) map.set(a.id, a);
    return Array.from(map.values());
  }, [albums]);

  return (
    <div className="grid grid-cols-3 gap-4">
      {albumsLoading ? (
        Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="aspect-square bg-gray-700 rounded-xl" />
        ))
      ) : (
        [...uniqueAlbums]
          .sort((a, b) => a.position - b.position)
          .map((album) => (
            <div key={album.id} className="group relative aspect-square bg-gray-700 rounded-xl overflow-hidden cursor-pointer hover:scale-105 transition-transform">
              <img
                src={album.image}
                alt={`${album.name} album cover`}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <div className="text-sm font-semibold mb-1 whitespace-nowrap overflow-hidden text-ellipsis">
                    {album.name}
                  </div>
                  <div className="text-xs text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis">
                    {album.artist}
                  </div>
                </div>
              </div>
              <button
                onClick={() => onRemove(album.id)}
                className="absolute top-2 right-2 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
              >
                ×
              </button>
            </div>
          ))
      )}
    </div>
  );
}
