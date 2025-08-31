'use client';


import { useEffect, useState } from "react";
import Skeleton from "@/components/shared/Skeleton";
import ResponsiveAlbumGrid from "@/components/wall/ResponsiveAlbumGrid";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import { useAppState } from "@/lib/utils/state-context";



export default function Home() {
  const { state, dispatch } = useAppState();
  const [qrs, setQrs] = useState<{ [key: string]: string }>({});

  const { albums, nowPlaying, queue: upNext, isLoading } = state;


  useEffect(() => {
    // Check for reset parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    const shouldReset = urlParams.get('reset') === 'true';

    if (shouldReset) {
      console.log('🔄 Resetting to default albums...');
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    // Only fetch QR codes for albums that don't already have them
    const albumsNeedingQrs = albums.filter(album => !qrs[album.id]);

    albumsNeedingQrs.forEach(album => {
      fetch(`/api/qr/${album.id}`)
        .then(res => {
          if (!res.ok) {
            throw new Error(`Failed to fetch QR for album ${album.id}`);
          }
          return res.json();
        })
        .then(data => {
          if (data.qr) {
            setQrs(prev => ({ ...prev, [album.id]: data.qr }));
          }
        })
        .catch(error => {
          console.warn(`Failed to fetch QR for album ${album.id}:`, error.message);
          // Set a placeholder or retry logic could go here
        });
    });
  }, [albums, qrs]);



  // Removed API usage for queue and albums on the wall; rely solely on WebSocket updates



  return (
    <div className="h-screen bg-black text-white px-8 lg:px-10 pt-10 pb-6 flex flex-col overflow-hidden">
      <ErrorBoundary>
        {/* Album Grid (auto-fits without bumping bottom) */}
        <div className="flex-1 min-h-0 overflow-hidden px-0 mb-8">
          <ResponsiveAlbumGrid albums={albums} qrs={qrs} albumsLoading={isLoading.albums} />
        </div>
      </ErrorBoundary>

      {/* Now Playing and Up Next Layout */}
      <div className="shrink-0 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Now Playing - Left Side (2/3 width) */}
        <div className="lg:col-span-2 bg-gray-800 rounded-2xl p-5 flex flex-col">
          <h2 className="text-lg font-bold mb-3 text-gray-300 tracking-wider text-center">Now Playing</h2>
          <ErrorBoundary>
            {isLoading.playback ? (
              // Loading playback: show skeleton
              <div className="flex flex-col items-center flex-grow text-center justify-center min-h-[clamp(12rem,24vh,16rem)]">
                <Skeleton className="w-[clamp(6rem,16vh,12rem)] h-[clamp(6rem,16vh,12rem)] rounded-lg" />
                <div className="mt-6 w-[min(16rem,60vw)]">
                  <Skeleton className="h-7 w-3/4 mx-auto mb-2" />
                  <Skeleton className="h-4 w-1/2 mx-auto" />
                </div>
              </div>
            ) : nowPlaying ? (
              // Ready and we have a track
              <div className="flex flex-col items-center flex-grow text-center min-h-[clamp(12rem,24vh,16rem)]">
                {nowPlaying.image ? (
                  <img
                    src={nowPlaying.image}
                    alt={nowPlaying.name}
                    className="w-[clamp(6rem,16vh,12rem)] h-[clamp(6rem,16vh,12rem)] rounded-lg shadow-lg object-cover"
                  />
                ) : (
                  <div className="w-[clamp(6rem,16vh,12rem)] h-[clamp(6rem,16vh,12rem)] rounded-lg bg-gray-700" />
                )}
                <div className="mt-6">
                  <h3 className="text-2xl font-bold truncate max-w-[90vw] lg:max-w-[60vw]">
                    {nowPlaying.name}
                  </h3>
                  <p className="text-sm text-gray-400 mt-1">{nowPlaying.artist}</p>
                </div>
              </div>
            ) : (
              // Ready but nothing is playing
              <div className="flex flex-col items-center flex-grow text-center justify-center min-h-[clamp(12rem,24vh,16rem)]">
                <div className="w-[clamp(6rem,16vh,12rem)] h-[clamp(6rem,16vh,12rem)] rounded-lg bg-gray-700" />
                <div className="mt-6 w-[min(16rem,60vw)] text-gray-400">
                  <p className="text-base">No track playing</p>
                </div>
              </div>
            )}
          </ErrorBoundary>
        </div>

        {/* Up Next - Right Side (1/3 width) */}
        <div className="bg-gray-800 rounded-2xl p-5 flex flex-col">
          <h2 className="text-lg font-bold mb-3 text-gray-300 tracking-wider text-center">Up Next</h2>
          <ErrorBoundary>
            <div className="flex-grow flex flex-col justify-center">
              {isLoading.queue ? (
                // Loading queue: show skeleton
                <div className="flex items-center space-x-3 p-2 rounded-lg h-20">
                  <Skeleton className="w-20 h-20 rounded-md" />
                  <div className="flex-grow">
                    <Skeleton className="h-5 w-28 mb-2" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                </div>
              ) : upNext.length > 0 ? (
                // Ready and we have an upcoming track
                <div className="flex items-center space-x-3 p-2 rounded-lg h-20">
                  {upNext[0]?.image ? (
                    <img
                      src={upNext[0].image!}
                      alt={`Album art for the next song in the queue`}
                      className="w-20 h-20 rounded-md object-cover"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-md bg-gray-700" />
                  )}
                  <div className="flex-grow min-w-0">
                    <p className="font-semibold text-base truncate">{upNext[0].name}</p>
                    <p className="text-sm text-gray-400 truncate">{upNext[0].artist}</p>
                  </div>
                </div>
              ) : (
                // Ready but no queue
                <div className="flex items-center justify-center h-20 rounded-lg">
                  <p className="text-gray-300 text-sm">Queue is empty</p>
                </div>
              )}
            </div>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
