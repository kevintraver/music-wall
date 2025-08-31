"use client";

import React, { useMemo } from "react";
import Image from "next/image";
import { Album } from "@/components/admin/AlbumWall";

// Individual Album Item Component
interface AlbumItemProps {
  album: Album;
  index: number;
  showQr: boolean;
  qrs?: { [key: string]: string };
  shouldCenterText: boolean;
  renderOverlayAction?: (album: Album, index: number) => React.ReactNode;
}

function AlbumItem({ album, index, showQr, qrs, shouldCenterText, renderOverlayAction }: AlbumItemProps) {
  return (
    <div className={`flex flex-col ${shouldCenterText ? "items-center" : "items-start"} w-full`}>
      {/* Album Cover */}
      <div className="relative w-full aspect-square rounded-md overflow-hidden mb-3">
        <img
          src={album.image}
          alt={`Album cover for ${album.name}`}
          className="w-full h-full object-cover rounded-md"
        />
        {renderOverlayAction && renderOverlayAction(album, index)}
      </div>

      {/* Album Text - Fixed height container */}
      <div className={`${shouldCenterText ? "text-center" : "text-left"} w-full mb-3 h-12 flex flex-col justify-start`}>
        <p className="font-semibold text-white text-sm leading-tight line-clamp-2 overflow-hidden">{album.name}</p>
        <p className="text-sm text-gray-400 leading-tight line-clamp-1 overflow-hidden">{album.artist}</p>
      </div>

      {/* QR Code - Always positioned at same level */}
      {showQr && qrs && qrs[album.id] ? (
        <div className="w-full flex justify-center flex-shrink-0">
          <Image
            src={qrs[album.id]}
            alt="QR Code"
            width={60}
            height={60}
            className="rounded"
          />
        </div>
      ) : (
        /* Spacer to maintain consistent height when no QR */
        <div className="h-[60px] w-full flex-shrink-0"></div>
      )}
    </div>
  );
}

// Loading Skeleton Component
interface AlbumSkeletonProps {
  shouldCenterText: boolean;
}

function AlbumSkeleton({ shouldCenterText }: AlbumSkeletonProps) {
  return (
    <div className={`flex flex-col ${shouldCenterText ? "items-center" : "items-start"} w-full`}>
      {/* Album Cover Skeleton */}
      <div className="w-full aspect-square bg-gray-700 rounded-md mb-3" />

      {/* Album Text Skeleton - Fixed height */}
      <div className={`${shouldCenterText ? "text-center" : "text-left"} w-full mb-3 h-12 flex flex-col justify-start`}>
        <div className="h-4 bg-gray-700 rounded mb-1" />
        <div className="h-3 bg-gray-600 rounded" />
      </div>

      {/* QR Code Skeleton - Consistent height */}
      <div className="w-full flex justify-center flex-shrink-0">
        <div className="w-[60px] h-[60px] bg-gray-700 rounded" />
      </div>
    </div>
  );
}

type BaseProps = {
  albums: Album[];
  albumsLoading: boolean;
  qrs?: { [key: string]: string };
  centerText?: boolean;
  renderOverlayAction?: (album: Album, index: number) => React.ReactNode;
};

export default function AlbumGrid({ albums, albumsLoading, qrs, centerText, renderOverlayAction }: BaseProps): React.JSX.Element {
  const showQr = Boolean(qrs);
  const shouldCenterText = centerText || showQr;

  // Use responsive grid that actually shrinks albums to fit
  const gridStyle = useMemo(() => {
    const minSize = showQr ? '140px' : '120px'; // Larger min size when QR codes are shown
    const maxSize = showQr ? '180px' : '160px'; // Larger max size when QR codes are shown
    return {
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(${minSize}, ${maxSize}))`,
      gap: '16px',
      justifyContent: 'center',
      alignItems: 'start',
      width: '100%',
      minHeight: 'fit-content',
    };
  }, [showQr]);

  return (
    <div style={gridStyle} className="w-full">
      {albumsLoading ? (
        Array.from({ length: 14 }).map((_, i) => (
          <AlbumSkeleton key={i} shouldCenterText={shouldCenterText} />
        ))
      ) : (
        albums.map((album, index) => (
          <AlbumItem
            key={album.id}
            album={album}
            index={index}
            showQr={showQr}
            qrs={qrs}
            shouldCenterText={shouldCenterText}
            renderOverlayAction={renderOverlayAction}
          />
        ))
      )}
    </div>
  );
}
