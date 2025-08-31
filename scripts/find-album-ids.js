#!/usr/bin/env node

const SpotifyWebApi = require('spotify-web-api-node');
require('dotenv').config();

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

// Albums to find
const albumsToFind = [
  { query: 'The Dark Side of the Moon Pink Floyd', year: '1973' },
  { query: 'Abbey Road The Beatles', year: '1969' },
  { query: 'Nevermind Nirvana', year: '1991' },
  { query: 'A Night At The Opera Queen', year: '1975' }
];

async function authenticateSpotify() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    console.log('✅ Spotify authentication successful');
    return true;
  } catch (error) {
    console.error('❌ Spotify authentication failed:', error.message);
    return false;
  }
}

async function findAlbum(albumQuery, year) {
  try {
    console.log(`\n🔍 Searching for: "${albumQuery}" (${year})`);

    const data = await spotifyApi.searchAlbums(`${albumQuery} year:${year}`, {
      limit: 5,
      market: 'US'
    });

    const albums = data.body.albums?.items || [];

    if (albums.length === 0) {
      console.log('❌ No albums found');
      return null;
    }

    // Find the best match
    const bestMatch = albums[0];
    console.log(`✅ Found: "${bestMatch.name}" by ${bestMatch.artists[0].name}`);
    console.log(`   ID: ${bestMatch.id}`);
    console.log(`   Release: ${bestMatch.release_date}`);
    console.log(`   Image: ${bestMatch.images[0]?.url}`);

    return {
      id: bestMatch.id,
      name: bestMatch.name,
      artist: bestMatch.artists[0].name,
      image: bestMatch.images[0]?.url || '',
      release_date: bestMatch.release_date
    };

  } catch (error) {
    console.error(`❌ Error searching for "${albumQuery}":`, error.message);
    return null;
  }
}

async function main() {
  console.log('🚀 Finding correct Spotify album IDs...\n');

  // Check for required environment variables
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('❌ Missing required environment variables:');
    console.error('   SPOTIFY_CLIENT_ID');
    console.error('   SPOTIFY_CLIENT_SECRET');
    console.error('\nPlease set these in your .env file');
    process.exit(1);
  }

  // Authenticate with Spotify
  const authenticated = await authenticateSpotify();
  if (!authenticated) {
    process.exit(1);
  }

  const foundAlbums = [];

  // Find each album
  for (const album of albumsToFind) {
    const result = await findAlbum(album.query, album.year);
    if (result) {
      foundAlbums.push(result);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Generate JSON output
  console.log('\n📋 JSON Output for data/albums.example.json:');
  console.log(JSON.stringify(foundAlbums.map((album, index) => ({
    id: album.id,
    name: album.name,
    artist: album.artist,
    image: album.image,
    position: index,
    tracks: []
  })), null, 2));

  console.log('\n✨ Done! Copy the JSON above to update your albums.example.json file.');
}

main().catch(console.error);