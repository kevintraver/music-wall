// localStorage utilities for album management
const ALBUMS_STORAGE_KEY = 'songwall_albums';
const DEFAULT_ALBUMS_KEY = 'songwall_default_loaded';

export interface Track {
  id: string;
  name: string;
  duration_ms: number;
  artist?: string;
  image?: string;
}

export interface Album {
  id: string;
  name: string;
  artist: string;
  image: string;
  position: number;
  tracks?: Track[];
}

// Load albums from localStorage
export function loadAlbumsFromStorage(): Album[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(ALBUMS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error loading albums from localStorage:', error);
    return [];
  }
}

// Save albums to localStorage
export function saveAlbumsToStorage(albums: Album[]): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(ALBUMS_STORAGE_KEY, JSON.stringify(albums));
  } catch (error) {
    console.error('Error saving albums to localStorage:', error);
  }
}

// Check if default albums have been loaded
export function hasLoadedDefaults(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    return localStorage.getItem(DEFAULT_ALBUMS_KEY) === 'true';
  } catch (error) {
    return false;
  }
}

// Mark that default albums have been loaded
export function markDefaultsLoaded(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(DEFAULT_ALBUMS_KEY, 'true');
  } catch (error) {
    console.error('Error marking defaults as loaded:', error);
  }
}

// Add a single album
export function addAlbum(album: Album): Album[] {
  const currentAlbums = loadAlbumsFromStorage();
  const exists = currentAlbums.some(a => a.id === album.id);

  if (!exists) {
    const newAlbum = { ...album, position: currentAlbums.length };
    const updatedAlbums = [...currentAlbums, newAlbum];
    saveAlbumsToStorage(updatedAlbums);
    return updatedAlbums;
  }

  return currentAlbums;
}

// Remove an album by ID
export function removeAlbum(albumId: string): Album[] {
  const currentAlbums = loadAlbumsFromStorage();
  const filteredAlbums = currentAlbums.filter(a => a.id !== albumId);

  // Reindex positions after removal
  const reindexedAlbums = filteredAlbums.map((album, index) => ({
    ...album,
    position: index
  }));

  saveAlbumsToStorage(reindexedAlbums);
  return reindexedAlbums;
}

// Reorder albums
export function reorderAlbums(updatedAlbums: Album[]): void {
  saveAlbumsToStorage(updatedAlbums);
}

// Set or update tracks for a specific album
export function setAlbumTracks(albumId: string, tracks: Track[]): Album[] {
  const current = loadAlbumsFromStorage();
  const idx = current.findIndex(a => a.id === albumId);
  if (idx === -1) return current;
  const updated = [...current];
  updated[idx] = { ...updated[idx], tracks };
  saveAlbumsToStorage(updated);
  return updated;
}

// Load default albums from server
export async function loadDefaultAlbums(): Promise<Album[]> {
  try {
    const response = await fetch('/api/albums/default');
    if (!response.ok) throw new Error('Failed to load default albums');

    const defaultAlbums = await response.json();
    saveAlbumsToStorage(defaultAlbums);
    markDefaultsLoaded();
    return defaultAlbums;
  } catch (error) {
    console.error('Error loading default albums:', error);
    return [];
  }
}

// Get albums (load defaults if not loaded yet)
export async function getAlbums(): Promise<Album[]> {
  let albums = loadAlbumsFromStorage();

  // If no albums in storage and defaults haven't been loaded, load them
  if (albums.length === 0 && !hasLoadedDefaults()) {
    console.log('Loading default albums...');
    albums = await loadDefaultAlbums();
  }

  return albums;
}

// Clear all album data and reset to defaults
export async function resetToDefaults(): Promise<Album[]> {
  if (typeof window === 'undefined') return [];

  try {
    // Clear localStorage
    localStorage.removeItem(ALBUMS_STORAGE_KEY);
    localStorage.removeItem(DEFAULT_ALBUMS_KEY);

    // Load fresh defaults
    console.log('Resetting to default albums...');
    const defaultAlbums = await loadDefaultAlbums();
    return defaultAlbums;
  } catch (error) {
    console.error('Error resetting to defaults:', error);
    return [];
  }
}
