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
  onRemove: (id: string) => void | Promise<void>;
  onReorder?: (updatedAlbums: Album[]) => void | Promise<void>;
};

export default function AlbumWall({ albums, albumsLoading, onRemove, onReorder }: Props) {
  const [draggedAlbum, setDraggedAlbum] = useState<Album | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Compute responsive grid layout based on album count
  const getGridLayout = (albumCount: number) => {
    if (albumCount <= 6) return { cols: 3, gap: 4 };
    if (albumCount <= 12) return { cols: 4, gap: 3 };
    if (albumCount <= 20) return { cols: 5, gap: 2 };
    if (albumCount <= 30) return { cols: 6, gap: 1 };
    return { cols: 8, gap: 1 };
  };

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

    if (!draggedAlbum || draggedIndex === null || !onReorder) {
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
      className="grid gap-4"
      style={{
        gridTemplateColumns: `repeat(${getGridLayout(albums.length).cols}, 1fr)`,
        gap: `${Math.max(2, getGridLayout(albums.length).gap - 1)}px`
      }}
      onDragOver={(e) => {
        if (draggedAlbum) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {albumsLoading ? (
        Array.from({ length: Math.min(20, Math.max(6, albums.length || 6)) }).map((_, i) => (
          <div key={i} className="flex flex-col min-h-0">
            <div className="aspect-square bg-gray-700 rounded-lg flex-shrink-0" />
            <div className="mt-1 px-1 h-8 bg-gray-700 rounded flex-1" />
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
                key={album.id}
                draggable={!isDraggedItem}
                onDragStart={(e) => handleDragStart(e, album, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`group relative flex flex-col min-h-0 cursor-move transition-all duration-200 select-none ${
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
                <div className="relative aspect-square bg-gray-700 rounded-lg overflow-hidden cursor-pointer hover:scale-105 transition-transform flex-shrink-0">
                  <img
                    src={album.image}
                    alt={`${album.name} album cover`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => onRemove(album.id)}
                    className="absolute top-1 right-1 w-6 h-6 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700 text-xs"
                  >
                    ×
                  </button>
                </div>
                <div className="mt-1 px-1 flex-1 min-h-0">
                  <div className="text-xs font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis leading-tight">
                    {album.name}
                  </div>
                  <div className="text-xs text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis leading-tight">
                    {album.artist}
                  </div>
                </div>
              </div>
            );
          })
      )}
    </div>
  );
}
