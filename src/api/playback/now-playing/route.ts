import { NextRequest, NextResponse } from 'next/server';
import SpotifyWebApi from 'spotify-web-api-node';

export async function GET(request: NextRequest) {
  const accessToken = request.headers.get('x-spotify-access-token') || '';

  if (!accessToken) {
    return NextResponse.json({ error: 'No access token provided' }, { status: 401 });
  }

  try {
    // Create Spotify API instance with user's token
    const spotifyApi = new SpotifyWebApi({
      accessToken: accessToken
    });

    const data = await spotifyApi.getMyCurrentPlayingTrack();
    if (data.body.item && 'artists' in data.body.item && 'album' in data.body.item) {
      return NextResponse.json({
        id: data.body.item.id,
        name: data.body.item.name,
        artist: data.body.item.artists[0].name,
        album: data.body.item.album.name,
        image: data.body.item.album.images[0]?.url
      });
    } else {
      return NextResponse.json(null);
    }
  } catch (error: any) {
    console.error('Error getting now playing:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}