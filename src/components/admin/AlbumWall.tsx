"use client";

import React, { useMemo, useState } from "react";
import AlbumGrid from "@/components/shared/AlbumGrid";

export interface Album {
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
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingAnyAlbum, setIsDraggingAnyAlbum] = useState(false);

  // Ensure unique albums by id to avoid React key warnings when duplicates slip in
  const uniqueAlbums = useMemo(() => {
    const map = new Map<string, Album>();
    for (const a of albums) map.set(a.id, a);
    return Array.from(map.values());
  }, [albums]);

  const handleDragStart = (e: React.DragEvent, album: Album, index: number) => {
    setDraggedAlbum(album);
    setDraggedIndex(index);
    setDragPosition({ x: e.clientX, y: e.clientY });
    setIsDraggingAnyAlbum(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (draggedAlbum) {
      setDragPosition({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setDraggedAlbum(null);
    setDraggedIndex(null);
    setDragOverIndex(null);
    setDragPosition(null);
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
      setIsDraggingAnyAlbum(false);
      return;
    }

    if (draggedIndex === dropIndex) {
      setDraggedAlbum(null);
      setDraggedIndex(null);
      setDragOverIndex(null);
      setIsDraggingAnyAlbum(false);
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
    setIsDraggingAnyAlbum(false);
  };

  const handleDragEnd = () => {
    setDraggedAlbum(null);
    setDraggedIndex(null);
    setDragOverIndex(null);
    setDragPosition(null);
    setIsDraggingAnyAlbum(false);
  };

  // Add mouse event listeners during drag
  React.useEffect(() => {
    if (draggedAlbum) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [draggedAlbum]);

  return (
    <div
      onDragOver={(e) => {
        if (draggedAlbum) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <AlbumGrid
        albums={[...uniqueAlbums].sort((a, b) => a.position - b.position)}
        albumsLoading={albumsLoading}
        centerText={true}
        renderOverlayAction={(album, index) => {
          const isDraggedItem = draggedAlbum?.id === album.id;
          const isDropTarget = dragOverIndex === index;
          const shouldShift =
            dragOverIndex !== null &&
            draggedIndex !== null &&
            ((index > draggedIndex && index <= dragOverIndex) ||
              (index < draggedIndex && index >= dragOverIndex));

          return (
            <div
              key={`admin-${album.id}`}
              draggable={!isDraggedItem}
              onDragStart={(e) => handleDragStart(e, album, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={`absolute inset-0 cursor-move transition-all duration-200 select-none rounded-lg group ${
                isDraggedItem ? "opacity-50 scale-95" : ""
              } ${isDropTarget ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-800" : ""} ${
                shouldShift ? "transform translate-x-2" : ""
              }`}
              style={{
                transform: shouldShift ? "translateX(8px)" : "translateX(0px)",
                transition: "transform 0.2s ease",
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
            >
              {!isDraggedItem && !isDraggingAnyAlbum && (
                <button
                  onClick={() => onRemove(album.id)}
                  className="absolute top-2 right-2 w-8 h-8 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all text-sm z-20 shadow-lg border-2 border-white/20"
                  type="button"
                  title="Remove album"
                >
                  🗑️
                </button>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
