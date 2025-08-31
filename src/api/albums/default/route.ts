import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const ALBUMS_FILE = path.join(process.cwd(), 'data', 'albums.example.json');

export async function GET() {
  try {
    // Load default albums from the example JSON file
    const data = fs.readFileSync(ALBUMS_FILE, 'utf8');
    const albums = JSON.parse(data);

    console.log(`Loaded ${albums.length} default albums from ${ALBUMS_FILE}`);
    return NextResponse.json(albums);
  } catch (error) {
    console.error('Error loading default albums:', error);
    return NextResponse.json([], { status: 500 });
  }
}