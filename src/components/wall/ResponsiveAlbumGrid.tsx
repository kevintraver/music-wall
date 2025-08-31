"use client";

import React, { useMemo } from "react";
import AlbumGrid from "@/components/shared/AlbumGrid";

type Album = {
  id: string;
  name: string;
  artist: string;
  image: string;
  position: number;
};

type Props = {
  albums: Album[];
  qrs: { [key: string]: string };
  albumsLoading: boolean;
};

export default function ResponsiveAlbumGrid({ albums, qrs, albumsLoading }: Props) {
  // Sort albums by position for consistent display
  const sortedAlbums = useMemo(() => {
    return [...albums].sort((a, b) => a.position - b.position);
  }, [albums]);

  return (
    <AlbumGrid
      albums={sortedAlbums}
      albumsLoading={albumsLoading}
      qrs={qrs}
    />
  );
}