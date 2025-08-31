export type MinimalTrack = {
  id?: string;
  uri?: string;
  name: string;
  artist?: string;
  image?: string;
};

// Normalize various backend/Spotify queue payload shapes into a flat track array
export function normalizeQueue(payload: any): MinimalTrack[] {
  let q: any[] = [];

  // Direct array
  if (Array.isArray(payload)) q = payload;

  // Common keys
  else if (Array.isArray(payload?.queue)) q = payload.queue;
  else if (Array.isArray(payload?.items)) q = payload.items;
  else if (Array.isArray(payload?.tracks)) q = payload.tracks;
  else if (Array.isArray(payload?.upNext)) q = payload.upNext;
  else if (Array.isArray(payload?.up_next)) q = payload.up_next;

  // Nested containers
  else if (Array.isArray(payload?.queue?.queue)) q = payload.queue.queue;
  else if (Array.isArray(payload?.queue?.items)) q = payload.queue.items;
  else if (Array.isArray(payload?.queue?.tracks)) q = payload.queue.tracks;

  // Flatten { track: {...} } wrappers (Spotify queue often uses this)
  if (q.length && q[0] && typeof q[0] === 'object' && 'track' in q[0]) {
    q = q.map((x: any) => x.track);
  }

  return q.map((t: any) => ({
    id: t?.id ?? t?.uid ?? undefined,
    uri: t?.uri,
    name: t?.name ?? '',
    artist: t?.artist ?? t?.artists?.[0]?.name ?? undefined,
    image: t?.image ?? t?.album?.images?.[0]?.url ?? undefined,
  }));
}
