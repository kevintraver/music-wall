"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Skeleton from "@/components/Skeleton";

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

function computeLayout(
  count: number,
  width: number,
  height: number,
  options?: { gap?: number; minSize?: number; textConst?: number; qrRatio?: number }
) {
  const gap = options?.gap ?? 16; // px between tiles
  const minSize = options?.minSize ?? 72; // minimum album image size in px
  const textConst = options?.textConst ?? 56; // approximate vertical space for text + margins + QR margin
  const qrRatio = options?.qrRatio ?? 0.5; // QR is half the image size

  if (count <= 0 || width <= 0 || height <= 0) {
    return { cols: 1, img: Math.max(minSize, 140), qr: Math.max(minSize * qrRatio, 70) };
  }

  let bestCols = 1;
  let bestSize = minSize;

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);

    // Max image size limited by width for this column count
    const sizeByWidth = (width - gap * (cols - 1)) / cols;

    // Tile height = image + qr + textConst = (1 + qrRatio) * image + textConst
    // Fit rows within height
    const sizeByHeight = (height - gap * (rows - 1) - rows * textConst) / (rows * (1 + qrRatio));

    const imgSize = Math.floor(Math.min(sizeByWidth, sizeByHeight));

    if (imgSize >= minSize && imgSize > bestSize) {
      bestSize = imgSize;
      bestCols = cols;
    }
  }

  // If we never found a size >= minSize, choose the best achievable (smallest rows/cols with max size)
  if (bestSize === minSize) {
    let fallbackSize = 0;
    let fallbackCols = Math.min(count, Math.max(1, Math.floor(width / (minSize + gap))));
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      const sizeByWidth = (width - gap * (cols - 1)) / cols;
      const sizeByHeight = (height - gap * (rows - 1) - rows * textConst) / (rows * (1 + qrRatio));
      const imgSize = Math.floor(Math.min(sizeByWidth, sizeByHeight));
      if (imgSize > fallbackSize) {
        fallbackSize = imgSize;
        fallbackCols = cols;
      }
    }
    bestSize = Math.max(1, Math.floor(fallbackSize));
    bestCols = fallbackCols;
  }

  const qr = Math.floor(bestSize * qrRatio);
  return { cols: Math.max(1, bestCols), img: bestSize, qr };
}

export default function ResponsiveAlbumGrid({ albums, qrs, albumsLoading }: Props) {
  const sorted = useMemo(() => [...albums].sort((a, b) => a.position - b.position), [albums]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [layout, setLayout] = useState({ cols: 2, img: 140, qr: 70 });

  useEffect(() => {
    if (!gridRef.current) return;
    const el = gridRef.current;

    const update = () => {
      const rect = el.getBoundingClientRect();
      // Account for padding applied on parent wrapper if any (we set px-6 outside this component)
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      setContainerSize({ width, height });
    };
    update();

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const { width, height } = containerSize;
    const computed = computeLayout(sorted.length, width, height, {
      gap: 16,
      minSize: 80,
      textConst: 56,
      qrRatio: 0.5,
    });
    setLayout(computed);
  }, [containerSize, sorted.length]);

  const gap = 16;
  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${layout.cols}, ${layout.img}px)`,
    gap: `${gap}px`,
    justifyContent: "center",
    alignContent: "center",
  };

  return (
    <div ref={gridRef} className="w-full h-full">
      {albumsLoading ? (
        <div style={gridStyle}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center">
              <Skeleton className="rounded-lg" style={{ width: layout.img, height: layout.img }} />
              <Skeleton className="mt-2" style={{ width: Math.floor(layout.img * 0.75), height: 16 }} />
              <Skeleton className="mt-1" style={{ width: Math.floor(layout.img * 0.5), height: 12 }} />
              <Skeleton className="mt-2" style={{ width: layout.qr, height: layout.qr }} />
            </div>
          ))}
        </div>
      ) : (
        <div style={gridStyle}>
          {sorted.map((album) => (
            <div key={album.id} className="flex flex-col items-center">
              <img
                src={album.image}
                alt={album.name}
                width={layout.img}
                height={layout.img}
                className="rounded-lg object-cover"
                style={{ width: layout.img, height: layout.img }}
              />
              <p className="text-center mt-2 text-sm truncate" style={{ maxWidth: layout.img }}>{album.name}</p>
              <p className="text-center text-xs text-gray-400 truncate" style={{ maxWidth: layout.img }}>{album.artist}</p>
              {qrs[album.id] ? (
                <Image
                  src={qrs[album.id]}
                  alt="QR Code"
                  width={layout.qr}
                  height={layout.qr}
                  className="mt-2"
                />
              ) : (
                <Skeleton className="mt-2" style={{ width: layout.qr, height: layout.qr }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

