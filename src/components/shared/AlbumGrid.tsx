"use client";

import React from "react";
import Image from "next/image";
import { Album } from "@/components/admin/AlbumWall";

type BaseProps = {
  albums: Album[];
  albumsLoading: boolean;
  qrs?: { [key: string]: string };
  centerText?: boolean;
  children?: (album: Album, index: number) => React.ReactNode;
};

export default function AlbumGrid({ albums, albumsLoading, qrs, centerText, children }: BaseProps): React.JSX.Element {
  const showQr = Boolean(qrs);
  const shouldCenterText = centerText || showQr;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-x-6 gap-y-8">
      {albumsLoading ? (
        Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className={`flex flex-col ${shouldCenterText ? "" : "items-start"} space-y-2`}>
            <div className="w-full aspect-square bg-gray-700 rounded-md" />
            <div className={`${shouldCenterText ? "text-center" : "text-left"} w-full`}>
              <div className="h-4 bg-gray-700 rounded mb-1" />
              <div className="h-3 bg-gray-600 rounded" />
            </div>
          </div>
        ))
      ) : (
        albums.map((album, index) => (
          <div key={album.id} className={`flex flex-col ${shouldCenterText ? "" : "items-start"} space-y-2`}>
            <div className="relative w-full aspect-square rounded-md overflow-hidden">
              <img
                src={album.image}
                alt={`Album cover for ${album.name}`}
                className="w-full aspect-square object-cover rounded-md"
              />
              {children && children(album, index)}
            </div>
            <div className={`${shouldCenterText ? "text-center mt-2 flex-grow" : "text-left"} w-full`}>
              <p className="font-semibold text-white text-sm leading-tight">{album.name}</p>
              <p className="text-sm text-gray-400 leading-tight">{album.artist}</p>
            </div>
            {showQr && qrs && qrs[album.id] ? (
              <div className="mt-2 self-center">
                <Image
                  src={qrs[album.id]}
                  alt="QR Code"
                  width={80}
                  height={80}
                  className="rounded"
                />
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
