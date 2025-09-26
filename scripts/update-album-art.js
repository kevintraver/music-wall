#!/usr/bin/env node

const SpotifyWebApi = require('spotify-web-api-node');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET
});

// Album IDs to update
const albumIds = [
  '4LH4d3cOWNNsVw41Gqt2kv', // The Dark Side of the Moon (1973) - Pink Floyd
  '0ETFjACtuP2ADo6LFhL6HN', // Abbey Road (1969) - The Beatles
  '2guirTSEqLizK7j9i1MTTZ', // Nevermind (1991) - Nirvana
  '6X9k3hSsvQck2OfKYdBbXr'  // A Night At The Opera (1975) - Queen
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

async function updateAlbumArt() {
  console.log('🎵 Updating album art from Spotify API...\n');

  const updatedAlbums = [];

  for (let i = 0; i < albumIds.length; i++) {
    const albumId = albumIds[i];

    try {
      console.log(`📀 Fetching album ${i + 1}/${albumIds.length}: ${albumId}`);

      const albumData = await spotifyApi.getAlbum(albumId, { market: 'US' });

      const album = {
        id: albumData.body.id,
        name: albumData.body.name,
        artist: albumData.body.artists[0].name,
        image: albumData.body.images[0]?.url || '',
        position: i,
        tracks: []
      };

      updatedAlbums.push(album);

      console.log(`✅ Updated: "${album.name}" by ${album.artist}`);
      console.log(`   Image: ${album.image.substring(0, 60)}...\n`);

      // Rate limiting - small delay between requests
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.error(`❌ Error fetching album ${albumId}:`, error.message);

      // Fallback to existing data if API fails
      const existingAlbums = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'albums.example.json'), 'utf8'));
      const existingAlbum = existingAlbums.find(a => a.id === albumId);
      if (existingAlbum) {
        existingAlbum.position = i;
        updatedAlbums.push(existingAlbum);
        console.log(`⚠️  Using existing data for ${existingAlbum.name}\n`);
      }
    }
  }

  // Write updated albums to file
  const albumsPath = path.join(__dirname, '..', 'data', 'albums.example.json');
  fs.writeFileSync(albumsPath, JSON.stringify(updatedAlbums, null, 2));

  console.log('🎉 Album art update complete!');
  console.log(`📁 Updated ${albumsPath}`);
  console.log('\n📋 Summary of updated albums:');
  updatedAlbums.forEach((album, index) => {
    console.log(`${index + 1}. "${album.name}" by ${album.artist}`);
  });
}

async function main() {
  console.log('🚀 Starting album art update process...\n');

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

  // Update album art
  await updateAlbumArt();

  console.log('\n✨ Done! Your album art is now up-to-date with Spotify.');
}

main().catch(console.error);