"use client";

import React, { useMemo, useState } from "react";

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
  onReorder: (updatedAlbums: Album[]) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
};

export default function AlbumWall({ albums, albumsLoading, onReorder, onRemove }: Props) {
  const [draggedAlbum, setDraggedAlbum] = useState<Album | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Ensure unique albums by id to avoid React key warnings when duplicates slip in
  const uniqueAlbums = useMemo(() => {
    const map = new Map<string, Album>();
    for (const a of albums) map.set(a.id, a);
    return Array.from(map.values());
  }, [albums]);

  const handleDragStart = (e: React.DragEvent, album: Album, index: number) => {
    e.stopPropagation();
    setDraggedAlbum(album);
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", album.id);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    // Allow drop within the grid items only
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedAlbum || draggedIndex === null) {
      setDraggedAlbum(null);
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    if (draggedIndex === dropIndex) {
      setDraggedAlbum(null);
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newAlbums = [...albums];
    const [removed] = newAlbums.splice(draggedIndex, 1);
    newAlbums.splice(dropIndex, 0, removed);

    const updatedAlbums = newAlbums.map((album, index) => ({
      ...album,
      position: index,
    }));

    await onReorder(updatedAlbums);

    setDraggedAlbum(null);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedAlbum(null);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-5 gap-6"
      onDragOver={(e) => {
        if (draggedAlbum) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {albumsLoading ? (
        Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="group relative">
            <div className="w-full h-auto rounded-lg aspect-square shadow-md bg-gray-100" />
            <div className="mt-3 text-center">
              <div className="w-3/4 h-4 mx-auto bg-gray-100 rounded" />
            </div>
          </div>
        ))
      ) : (
        [...uniqueAlbums]
          .sort((a, b) => a.position - b.position)
          .map((album, index) => {
            const isDraggedItem = draggedAlbum?.id === album.id;
            const isDropTarget = dragOverIndex === index;
            const shouldShift =
              dragOverIndex !== null &&
              draggedIndex !== null &&
              ((index > draggedIndex && index <= dragOverIndex) ||
                (index < draggedIndex && index >= dragOverIndex));

            return (
              <div
                key={album.id ? `${album.id}-${album.position ?? index}` : `${album.name}-${album.artist}-${index}`}
                draggable={!isDraggedItem}
                onDragStart={(e) => handleDragStart(e, album, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`group relative cursor-move transition-all duration-200 select-none ${
                  isDraggedItem ? "opacity-50 scale-95" : ""
                } ${isDropTarget ? "ring-2 ring-blue-500 ring-offset-2" : ""} ${
                  shouldShift ? "transform translate-x-2" : ""
                }`}
                style={{
                  transform: shouldShift ? "translateX(8px)" : "translateX(0px)",
                  transition: "transform 0.2s ease",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                }}
              >
                <img
                  alt={`${album.name} album cover`}
                  className="w-full h-auto rounded-lg object-cover aspect-square shadow-md"
                  src={album.image}
                />
                <div className="absolute top-2 left-2 bg-black/70 text-white px-2 py-1 rounded text-xs">
                  {index + 1}
                </div>
                <button
                  onClick={() => onRemove(album.id)}
                  className="absolute top-2 right-2 bg-red-600 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white"
                >
                  <span className="material-icons text-base">delete</span>
                </button>
                {/* Removed hover popover with album name/artist to avoid duplicate tooltip in admin */}
                <div className="mt-3 text-center">
                  <p className="font-semibold text-gray-800 text-base leading-tight">{album.name}</p>
                  <p className="text-sm text-gray-500 mt-1">{album.artist}</p>
                </div>
              </div>
            );
          })
      )}
    </div>
  );
}
