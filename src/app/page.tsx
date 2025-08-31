'use client';


import { useEffect, useState } from "react";
import Skeleton from "@/components/shared/Skeleton";
import ResponsiveAlbumGrid from "@/components/wall/ResponsiveAlbumGrid";
import ErrorBoundary from "@/components/shared/ErrorBoundary";
import { useAppState } from "@/lib/utils/state-context";
import { logger } from "@/lib/utils/logger";



export default function Home() {
  const { state, dispatch } = useAppState();
  const [qrs, setQrs] = useState<{ [key: string]: string }>({});

  const { albums, nowPlaying, queue: upNext, isLoading } = state;


  useEffect(() => {
    // Check for reset parameter in URL
    const urlParams = new URLSearchParams(window.location.search);
    const shouldReset = urlParams.get('reset') === 'true';

    if (shouldReset) {
      logger.info('Resetting to default albums...');
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
    <div className="min-h-screen bg-black text-white px-8 lg:px-10 pt-10 pb-6 flex flex-col">
      <ErrorBoundary>
        {/* Album Grid (auto-fits without bumping bottom) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-0 mb-8">
          <ResponsiveAlbumGrid albums={albums} qrs={qrs} albumsLoading={isLoading.albums} />
        </div>
      </ErrorBoundary>

      {/* Now Playing and Up Next Layout */}
      <div className="shrink-0 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Now Playing - Left Side (2/3 width) */}
        <div className="lg:col-span-2 bg-gray-800 rounded-2xl p-6 flex flex-col">
          <div className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 text-center">
            Now Playing
          </div>
          <ErrorBoundary>
             <div className="flex-1 flex items-center justify-center">
               {isLoading.playback ? (
                 // Loading playback: show skeleton
                 <div className="flex gap-4 items-center">
                   <Skeleton className="w-16 h-16 rounded-lg flex-shrink-0" />
                   <div className="flex-1">
                     <Skeleton className="h-5 w-40 mb-1" />
                     <Skeleton className="h-4 w-32" />
                   </div>
                 </div>
               ) : nowPlaying ? (
                 // Ready and we have a track
                 <div className="flex gap-4 items-center">
                   <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 shadow-lg relative">
                     {nowPlaying.image ? (
                       <>
                         <img
                           src={nowPlaying.image}
                           alt={nowPlaying.name}
                           className="w-full h-full object-cover"
                         />
                         <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none"></div>
                       </>
                     ) : (
                       <div className="w-full h-full bg-gradient-to-br from-red-600 to-red-800"></div>
                     )}
                   </div>
                   <div className="flex-1">
                     <h3 className="text-lg font-semibold mb-1 leading-tight truncate">
                       {nowPlaying.name}
                     </h3>
                     <p className="text-sm text-gray-400 truncate">{nowPlaying.artist}</p>
                   </div>
                 </div>
               ) : (
                 // Ready but nothing is playing
                 <div className="flex gap-4 items-center">
                   <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 shadow-lg bg-gradient-to-br from-gray-700 to-gray-800"></div>
                   <div className="flex-1">
                     <div className="h-5 mb-1"></div>
                     <p className="text-sm text-gray-400">No track playing</p>
                   </div>
                 </div>
               )}
             </div>
          </ErrorBoundary>
        </div>

        {/* Up Next - Right Side (1/3 width) */}
        <div className="bg-gray-800 rounded-2xl p-6 flex flex-col">
          <div className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 text-center">
            Up Next
          </div>
          <ErrorBoundary>
            <div className="flex-1 flex items-center justify-center">
              {isLoading.queue ? (
                // Loading queue: show skeleton
                <div className="flex gap-4 items-center">
                  <Skeleton className="w-16 h-16 rounded-lg flex-shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-5 w-40 mb-1" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </div>
              ) : upNext.length > 0 ? (
                // Ready and we have an upcoming track
                <div className="flex gap-4 items-center">
                  <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 shadow-lg relative">
                    {upNext[0]?.image ? (
                      <>
                        <img
                          src={upNext[0].image}
                          alt={`${upNext[0].album} album cover`}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none"></div>
                      </>
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-gray-600 to-gray-800"></div>
                    )}
                  </div>
                  <div className="flex-1">
                    <h4 className="text-lg font-semibold mb-1 leading-tight truncate">
                      {upNext[0].name}
                    </h4>
                    <p className="text-sm text-gray-400 truncate">{upNext[0].artist}</p>
                  </div>
                </div>
              ) : (
                // Ready but no queue
                <div className="flex items-center justify-center h-20">
                  <p className="text-gray-400 text-sm">Queue is empty</p>
                </div>
              )}
            </div>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
