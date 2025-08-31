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
    <div className="grid grid-cols-4 gap-6">
      {albumsLoading ? (
        Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex flex-col">
            <div className="aspect-square bg-gray-700 rounded-xl mb-2" />
            <div className="h-8 bg-gray-700 rounded" />
          </div>
        ))
      ) : (
        [...uniqueAlbums]
          .sort((a, b) => a.position - b.position)
          .map((album) => (
            <div key={album.id} className="group flex flex-col">
              <div className="relative aspect-square bg-gray-700 rounded-xl overflow-hidden cursor-pointer hover:scale-105 transition-transform mb-2">
                <img
                  src={album.image}
                  alt={`${album.name} album cover`}
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => onRemove(album.id)}
                  className="absolute top-2 right-2 w-8 h-8 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
                >
                  <span className="material-icons text-sm">delete</span>
                </button>
              </div>
                <div className="mt-3 w-full px-2">
                  <div style={{ height: 32, overflow: "hidden", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                    <p
                      className="text-center font-semibold text-white leading-tight"
                      style={{
                        width: "100%",
                        maxWidth: 120,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        fontSize: "14px",
                      }}
                    >
                      {album.name}
                    </p>
                  </div>
                  <div style={{ height: 4 }} />
                  <div style={{ height: 16, overflow: "hidden" }}>
                    <p
                      className="text-center text-gray-400 leading-tight"
                      style={{
                        width: "100%",
                        maxWidth: 120,
                        display: "-webkit-box",
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        fontSize: "12px",
                      }}
                    >
                      {album.artist}
                    </p>
                  </div>
                </div>
            </div>
          ))
      )}
    </div>
  );
}
