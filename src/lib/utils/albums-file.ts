import * as fs from 'fs';
import * as path from 'path';
import type { Album } from '@/websocket/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const ALBUMS_FILE = path.join(DATA_DIR, 'albums.json');
const DEFAULT_FILE = path.join(DATA_DIR, 'albums.example.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function readAlbumsFromFile(): Album[] {
  try {
    let data: any;
    if (fs.existsSync(ALBUMS_FILE)) {
      data = JSON.parse(fs.readFileSync(ALBUMS_FILE, 'utf8'));
    } else if (fs.existsSync(DEFAULT_FILE)) {
      data = JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8'));
    } else {
      return [];
    }

    if (Array.isArray(data)) {
      return data as Album[];
    } else {
      console.warn('Albums file contains invalid data (not an array), returning empty array');
      return [];
    }
  } catch (e) {
    console.warn('Failed to read albums file:', e);
    return [];
  }
}

export function writeAlbumsToFile(albums: Album[]): void {
  try {
    ensureDataDir();
    fs.writeFileSync(ALBUMS_FILE, JSON.stringify(albums, null, 2));
  } catch (e) {
    console.error('Failed to write albums file:', e);
  }
}

export function addAlbumToFile(album: Album): Album[] {
  const albums = readAlbumsFromFile();
  if (!albums.some(a => a.id === album.id)) {
    const withPos = { ...album, position: albums.length };
    const updated = [...albums, withPos];
    writeAlbumsToFile(updated);
    return updated;
  }
  return albums;
}

export function updateAlbumInFile(updatedAlbum: Album): Album[] {
  const albums = readAlbumsFromFile();
  const idx = albums.findIndex(a => a.id === updatedAlbum.id);
  if (idx !== -1) {
    albums[idx] = { ...albums[idx], ...updatedAlbum } as Album;
    writeAlbumsToFile(albums);
  }
  return albums;
}

export function removeAlbumFromFile(id: string): Album[] {
  const albums = readAlbumsFromFile();
  const filtered = albums.filter(a => a.id !== id).map((a, i) => ({ ...a, position: i }));
  writeAlbumsToFile(filtered);
  return filtered;
}

