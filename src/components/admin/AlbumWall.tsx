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
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-x-6 gap-y-8">
      {albumsLoading ? (
        Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="flex flex-col items-start space-y-2">
            <div className="w-full aspect-square bg-gray-700 rounded-md" />
            <div className="text-left w-full">
              <div className="h-4 bg-gray-700 rounded mb-1" />
              <div className="h-3 bg-gray-600 rounded" />
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
                key={album.id}
                draggable={!isDraggedItem}
                onDragStart={(e) => handleDragStart(e, album, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex flex-col items-start space-y-2 cursor-move transition-all duration-200 select-none ${
                  isDraggedItem ? "opacity-50 scale-95" : ""
                } ${isDropTarget ? "ring-2 ring-blue-500" : ""} ${
                  shouldShift ? "transform translate-x-2" : ""
                }`}
                style={{
                  transform: shouldShift ? "translateX(8px)" : "translateX(0px)",
                  transition: "transform 0.2s ease",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                }}
              >
                <div className="relative w-full aspect-square rounded-md overflow-hidden">
                  <img
                    src={album.image}
                    alt={`Album cover for ${album.name}`}
                    className="w-full aspect-square object-cover rounded-md"
                  />
                  <button
                    onClick={() => onRemove(album.id)}
                    className="absolute top-2 right-2 w-6 h-6 bg-red-600 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity text-xs"
                  >
                    ×
                  </button>
                </div>
                <div className="text-left w-full">
                  <p className="font-semibold text-white text-sm leading-tight">{album.name}</p>
                  <p className="text-sm text-gray-400 leading-tight">{album.artist}</p>
                </div>
              </div>
            );
          })
      )}
    </div>
  );
}
