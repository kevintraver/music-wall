"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Skeleton from "@/components/shared/Skeleton";

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
  options?: { gap?: number; minSize?: number; textConst?: number; qrRatio?: number; safety?: number; maxCols?: number }
) {
  const gap = options?.gap ?? 16; // px between tiles
  const minSize = options?.minSize ?? 72; // minimum album image size in px
  const textConst = options?.textConst ?? 56; // approximate vertical space for text + margins + QR margin
  const qrRatio = options?.qrRatio ?? 0.5; // QR is half the image size
  const safety = options?.safety ?? 24; // reserve bottom padding to avoid clipping

  if (count <= 0 || width <= 0 || height <= 0) {
    return { cols: 1, img: Math.max(minSize, 140), qr: Math.max(minSize * qrRatio, 70) };
  }

  let bestCols = 1;
  let bestSize = minSize;

  // Use an effective height that leaves a small safety margin
  const effectiveHeight = Math.max(0, height - safety);

  // Cap the number of columns so that with many items we start
  // wrapping earlier instead of cramming them into a single row.
  const hardMaxCols = Math.max(1, Math.min(count, options?.maxCols ?? count));

  for (let cols = 1; cols <= hardMaxCols; cols++) {
    const rows = Math.ceil(count / cols);

    // Max image size limited by width for this column count
    const sizeByWidth = (width - gap * (cols - 1)) / cols;

    // Tile height = image + qr + textConst = (1 + qrRatio) * image + textConst
    // Fit rows within height
    const sizeByHeight = (effectiveHeight - gap * (rows - 1) - rows * textConst) / (rows * (1 + qrRatio));

    const imgSize = Math.floor(Math.min(sizeByWidth, sizeByHeight));

    if (imgSize >= minSize && imgSize > bestSize) {
      bestSize = imgSize;
      bestCols = cols;
    }
  }

  // If we never found a size >= minSize, choose the best achievable (smallest rows/cols with max size)
  if (bestSize === minSize) {
    let fallbackSize = 0;
    let fallbackCols = Math.min(hardMaxCols, Math.max(1, Math.floor(width / (minSize + gap))));
    for (let cols = 1; cols <= hardMaxCols; cols++) {
      const rows = Math.ceil(count / cols);
      const sizeByWidth = (width - gap * (cols - 1)) / cols;
      const sizeByHeight = (effectiveHeight - gap * (rows - 1) - rows * textConst) / (rows * (1 + qrRatio));
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
  // Fixed sub-blocks so title, artist and QR align across tiles
  const TITLE_BLOCK = 40; // px; 2 lines at leading-tight, tighter spacing
  const ARTIST_BLOCK = 20; // px; space for 1 line (leading-tight)
  const TITLE_TO_ARTIST_GAP = 4; // px; small spacing between title and artist
  // Tailwind `mt-3` ≈ 12px (image → text gap); same between text → QR
  const TEXT_TOP_MARGIN = 12; // image to text container
  const QR_TOP_MARGIN = 12;   // text container to QR
  
  // Estimate a font size (in px) that lets the text fit within a target
  // number of lines inside a box of width `imgWidth`. Falls back to sensible
  // min/max bounds to avoid unreadable sizes.
  const estimateFontPx = (text: string, imgWidth: number, opts?: { base?: number; min?: number; max?: number; lines?: number }) => {
    const base = opts?.base ?? 16; // px for text-base
    const min = opts?.min ?? 12;  // px minimum to remain legible
    const max = opts?.max ?? base; // do not exceed requested base
    const lines = Math.max(1, opts?.lines ?? 2); // default allow two lines for album name
    const n = Math.max(1, (text || "").length);
    // Approx average glyph width ≈ 0.58em. Estimate required px size to fit all chars within `lines` lines.
    const coeff = 0.58;
    const est = (lines * imgWidth) / (coeff * n);
    return Math.max(min, Math.min(max, Math.floor(est)));
  };

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
    // Prefer earlier wrapping as item count grows. Cap max columns to keep
    // rows reasonable and avoid having a long single row at the top.
    const computeMaxCols = (n: number) => {
      if (n <= 6) return n;      // small sets can stay on one row
      if (n <= 12) return 6;     // 7-12 items → wrap to ~2 rows
      if (n <= 18) return 7;     // 13-18 items → slightly wider rows
      return 8;                  // many items → cap at 8 per row
    };
    const computed = computeLayout(sorted.length, width, height, {
      gap: 32,
      minSize: 80,
      // Match rendering: title block + gap + artist block + top margin + QR margin
      textConst: (TITLE_BLOCK + TITLE_TO_ARTIST_GAP + ARTIST_BLOCK) + TEXT_TOP_MARGIN + QR_TOP_MARGIN,
      qrRatio: 0.4,
      safety: 36, // small bottom reserve to avoid clipping
      maxCols: computeMaxCols(sorted.length),
    });
    setLayout(computed);
  }, [containerSize, sorted.length]);

  const gap = 32;
  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${layout.cols}, ${layout.img}px)`,
    gap: `${gap}px`,
    width: "100%",
    justifyContent: layout.cols > 1 ? "space-around" : "center",
    justifyItems: "center",
    alignContent: "center",
  };

  return (
    <div ref={gridRef} className="w-full h-full">
      {albumsLoading ? (
        <div style={gridStyle}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center">
              <Skeleton className="rounded-lg" style={{ width: layout.img, height: layout.img }} />
              <div className="mt-3" style={{ width: layout.img }}>
                <div style={{ height: TITLE_BLOCK, overflow: "hidden", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                  <Skeleton style={{ width: Math.floor(layout.img * 0.8), height: 16 }} />
                  <Skeleton className="mt-2" style={{ width: Math.floor(layout.img * 0.6), height: 12 }} />
                </div>
                <div style={{ height: TITLE_TO_ARTIST_GAP }} />
                <div style={{ height: ARTIST_BLOCK, overflow: "hidden" }}>
                  <Skeleton style={{ width: Math.floor(layout.img * 0.5), height: 12 }} />
                </div>
              </div>
              <Skeleton className="mt-3" style={{ width: layout.qr, height: layout.qr }} />
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
              <div className="mt-3 w-full" style={{ height: TITLE_BLOCK + TITLE_TO_ARTIST_GAP + ARTIST_BLOCK }}>
                <div style={{ height: TITLE_BLOCK, overflow: "hidden", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                  <p
                    className="text-center font-medium leading-tight"
                    style={{
                      width: "100%",
                      maxWidth: layout.img,
                      // Allow up to 2 lines, no single-line truncation
                      display: "-webkit-box",
                      WebkitLineClamp: 2 as any,
                      WebkitBoxOrient: "vertical" as any,
                      overflow: "hidden",
                      // Dynamically shrink to fit width within 2 lines
                      fontSize: `${estimateFontPx(album.name, layout.img, { base: 16, min: 11, max: 16, lines: 2 })}px`,
                    }}
                  >
                    {album.name}
                  </p>
                </div>
                <div style={{ height: TITLE_TO_ARTIST_GAP }} />
                <div style={{ height: ARTIST_BLOCK, overflow: "hidden" }}>
                  <p
                    className="text-center text-gray-400 leading-tight"
                    style={{
                      width: "100%",
                      maxWidth: layout.img,
                      // Artist can wrap to 1 line; shrink slightly if very long
                      display: "-webkit-box",
                      WebkitLineClamp: 1 as any,
                      WebkitBoxOrient: "vertical" as any,
                      overflow: "hidden",
                      fontSize: `${estimateFontPx(album.artist, layout.img, { base: 14, min: 10, max: 14, lines: 1 })}px`,
                    }}
                  >
                    {album.artist}
                  </p>
                </div>
              </div>
              {qrs[album.id] ? (
                <Image
                  src={qrs[album.id]}
                  alt="QR Code"
                  width={layout.qr}
                  height={layout.qr}
                  className="mt-3"
                />
              ) : (
                <Skeleton className="mt-3" style={{ width: layout.qr, height: layout.qr }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
