'use client';

import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { Album, Track } from '@/websocket/types';
import { logger } from '@/lib/utils/logger';

// State interface
interface AppState {
  albums: Album[];
  nowPlaying: Track | null;
  queue: Track[];
  isPlaying: boolean;
  isLoading: {
    albums: boolean;
    playback: boolean;
    queue: boolean;
  };
  error: string | null;
}

// Action types
type AppAction =
  | { type: 'SET_ALBUMS'; payload: Album[] }
  | { type: 'SET_NOW_PLAYING'; payload: Track | null }
  | { type: 'SET_QUEUE'; payload: Track[] }
  | { type: 'SET_IS_PLAYING'; payload: boolean }
  | { type: 'SET_LOADING'; payload: { key: keyof AppState['isLoading']; value: boolean } }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'ADD_ALBUM'; payload: Album }
  | { type: 'REMOVE_ALBUM'; payload: string }
  | { type: 'UPDATE_ALBUM'; payload: Album }
  | { type: 'REORDER_ALBUMS'; payload: Album[] };

// Initial state
const initialState: AppState = {
  albums: [],
  nowPlaying: null,
  queue: [],
  isPlaying: false,
  isLoading: {
    albums: true,
    playback: true,
    queue: true,
  },
  error: null,
};

// Reducer
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_ALBUMS':
      return { ...state, albums: action.payload, isLoading: { ...state.isLoading, albums: false } };
    case 'SET_NOW_PLAYING':
      return { ...state, nowPlaying: action.payload, isLoading: { ...state.isLoading, playback: false } };
    case 'SET_QUEUE':
      return { ...state, queue: action.payload, isLoading: { ...state.isLoading, queue: false } };
    case 'SET_IS_PLAYING':
      return { ...state, isPlaying: action.payload };
    case 'SET_LOADING':
      return { ...state, isLoading: { ...state.isLoading, [action.payload.key]: action.payload.value } };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'ADD_ALBUM':
      return { ...state, albums: [...state.albums, action.payload] };
    case 'REMOVE_ALBUM':
      return { ...state, albums: state.albums.filter(album => album.id !== action.payload) };
    case 'UPDATE_ALBUM':
      return {
        ...state,
        albums: state.albums.map(album =>
          album.id === action.payload.id ? action.payload : album
        )
      };
    case 'REORDER_ALBUMS':
      return { ...state, albums: action.payload };
    default:
      return state;
  }
}

// Context
const AppStateContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

// Provider component
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // WebSocket connection and message handling
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000;

    const connect = () => {
      if (ws && ws.readyState === WebSocket.OPEN) return;

      ws = new WebSocket(`ws://${window.location.hostname}:3002`);

      ws.onopen = () => {
        logger.websocket('Main wall WebSocket connected to port 3002');
        reconnectAttempts = 0;
        dispatch({ type: 'SET_LOADING', payload: { key: 'playback', value: false } });
        dispatch({ type: 'SET_LOADING', payload: { key: 'queue', value: false } });
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          logger.websocket('Main wall received WebSocket message:', data.type);

          switch (data.type) {
             case 'albums':
               if (Array.isArray(data.payload)) {
                 dispatch({ type: 'SET_ALBUMS', payload: data.payload });
               } else if (Array.isArray(data.albums)) {
                 dispatch({ type: 'SET_ALBUMS', payload: data.albums });
               }
               break;
             case 'playback':
               logger.playback('Main wall received playback update:', {
                 hasTrack: !!(data.payload?.nowPlaying),
                 trackName: data.payload?.nowPlaying?.name || 'None',
                 isPlaying: data.payload?.isPlaying
               });
               if (data.payload) {
                 if (data.payload.nowPlaying !== undefined) {
                   dispatch({ type: 'SET_NOW_PLAYING', payload: data.payload.nowPlaying });
                 }
                 if (data.payload.isPlaying !== undefined) {
                   dispatch({ type: 'SET_IS_PLAYING', payload: data.payload.isPlaying });
                 }
                 if (data.payload.queue !== undefined) {
                   dispatch({ type: 'SET_QUEUE', payload: data.payload.queue });
                 }
               }
               break;
            case 'queue':
              if (Array.isArray(data.payload)) {
                dispatch({ type: 'SET_QUEUE', payload: data.payload });
              }
              break;
            case 'pong':
              // Heartbeat response, ignore
              break;
            default:
              console.log('Unknown WebSocket message type:', data.type);
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected, attempting reconnection...');
        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
          setTimeout(() => {
            reconnectAttempts++;
            connect();
          }, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    };

    connect();

    // Heartbeat
    const heartbeatInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (ws) ws.close();
    };
  }, []);

  return (
    <AppStateContext.Provider value={{ state, dispatch }}>
      {children}
    </AppStateContext.Provider>
  );
}

// Hook to use the context
export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return context;
}

// Action creators for convenience
export const appActions = {
  setAlbums: (albums: Album[]) => ({ type: 'SET_ALBUMS' as const, payload: albums }),
  setNowPlaying: (track: Track | null) => ({ type: 'SET_NOW_PLAYING' as const, payload: track }),
  setQueue: (queue: Track[]) => ({ type: 'SET_QUEUE' as const, payload: queue }),
  setIsPlaying: (isPlaying: boolean) => ({ type: 'SET_IS_PLAYING' as const, payload: isPlaying }),
  setLoading: (key: keyof AppState['isLoading'], value: boolean) =>
    ({ type: 'SET_LOADING' as const, payload: { key, value } }),
  setError: (error: string | null) => ({ type: 'SET_ERROR' as const, payload: error }),
  addAlbum: (album: Album) => ({ type: 'ADD_ALBUM' as const, payload: album }),
  removeAlbum: (albumId: string) => ({ type: 'REMOVE_ALBUM' as const, payload: albumId }),
  updateAlbum: (album: Album) => ({ type: 'UPDATE_ALBUM' as const, payload: album }),
  reorderAlbums: (albums: Album[]) => ({ type: 'REORDER_ALBUMS' as const, payload: albums }),
};