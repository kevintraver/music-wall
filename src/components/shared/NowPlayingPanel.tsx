"use client";

import React from "react";
import Skeleton from "@/components/shared/Skeleton";

interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  image: string;
}

type Props = {
  nowPlaying: Track | null;
  isPlaying: boolean;
  playbackLoaded: boolean;
  playbackUpdatePending: boolean;
  playbackActionInProgress: string | null;
  onAction: (action: "previous" | "play" | "pause" | "next", endpoint: string) => void;
  colSpan?: string;
};

function NowPlayingPanelImpl({
  nowPlaying,
  isPlaying,
  playbackLoaded,
  playbackUpdatePending,
  playbackActionInProgress,
  onAction,
  colSpan = "lg:col-span-2",
}: Props) {
  return (
    <div className={`${colSpan} bg-white p-6 rounded-xl shadow-md flex flex-col`}>
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Now Playing</h2>
      <div className="flex-grow flex flex-col sm:flex-row items-center justify-center text-center bg-gray-800 text-white p-6 rounded-lg mb-4 gap-6 relative">
        {playbackUpdatePending && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center rounded-lg z-10">
            <div className="flex items-center space-x-2 bg-gray-900/90 px-4 py-2 rounded-lg">
              <span className="material-icons animate-spin text-sm">sync</span>
              <span className="text-sm">Updating...</span>
            </div>
          </div>
        )}
        {playbackLoaded ? (
          nowPlaying ? (
            <>
              <img
                alt={`${nowPlaying.album} album cover`}
                className="w-48 h-48 rounded-lg shadow-lg"
                src={nowPlaying.image}
              />
              <div className="flex-1 flex flex-col items-center text-center">
                <p className="text-3xl font-bold">{nowPlaying.name}</p>
                <p className="text-xl text-gray-300 mt-1">{nowPlaying.artist}</p>
                <div className="flex items-center justify-center space-x-6 mt-6">
                    <button
                      type="button"
                      aria-label="Previous"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction("previous", "/api/playback/playback/previous"); }}
                      disabled={!!playbackActionInProgress}
                      className="bg-gray-700 text-white w-14 h-14 rounded-full hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="material-icons text-3xl">skip_previous</span>
                    </button>
                    <button
                      type="button"
                      aria-label={isPlaying ? "Pause" : "Play"}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction(isPlaying ? "pause" : "play", `/api/playback/playback/${isPlaying ? "pause" : "play"}`); }}
                      disabled={!!playbackActionInProgress}
                      className={`text-white w-16 h-16 rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-green-500 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ${
                        isPlaying ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                      }`}
                    >
                      <span className="material-icons text-4xl">{isPlaying ? "pause" : "play_arrow"}</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Next"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAction("next", "/api/playback/playback/next"); }}
                      disabled={!!playbackActionInProgress}
                      className="bg-gray-700 text-white w-14 h-14 rounded-full hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="material-icons text-3xl">skip_next</span>
                    </button>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xl">No track playing</p>
          )
        ) : (
          <div className="w-full flex items-center justify-center gap-6">
            <Skeleton className="w-48 h-48 rounded-lg" />
            <div className="flex-1 max-w-sm">
              <Skeleton className="w-3/4 h-7" />
              <Skeleton className="w-1/2 h-5 mt-3" />
              <div className="flex items-center justify-center space-x-6 mt-6">
                <Skeleton className="w-14 h-14 rounded-full" />
                <Skeleton className="w-16 h-16 rounded-full" />
                <Skeleton className="w-14 h-14 rounded-full" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const NowPlayingPanel = React.memo(NowPlayingPanelImpl);
export default NowPlayingPanel;
