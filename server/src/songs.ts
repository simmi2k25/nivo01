import { config } from './config.js';
import { one, query } from './db.js';
import { fail } from './http.js';

/** A song ready to play in a Chill Room: Apple Music details and cover, played in full from YouTube. */
export type PlayableSong = {
  title: string;
  artist: string;
  artwork: string | null;
  videoId: string;
  durationMs: number | null;
};

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YT = 'https://www.googleapis.com/youtube/v3';

const ARTWORK_HOST = /(^|\.)(mzstatic\.com|ytimg\.com)$/;
export function safeArtwork(v: unknown) {
  if (typeof v !== 'string' || !v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && ARTWORK_HOST.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "PT3M36S" → 216000 */
function isoDurationMs(iso: string | undefined) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
}

async function youtube<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!config.youtubeApiKey) throw fail(503, 'Full songs aren’t switched on yet — the app owner needs to add a YouTube API key');
  const qs = new URLSearchParams({ ...params, key: config.youtubeApiKey });
  const r = await fetch(`${YT}/${path}?${qs}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r) throw fail(502, 'Couldn’t reach YouTube — try again');
  if (r.status === 403) {
    console.error('[songs] YouTube refused the request', await r.text().catch(() => ''));
    throw fail(503, 'The song finder is resting for today — paste a YouTube link instead');
  }
  if (!r.ok) throw fail(502, 'Couldn’t reach YouTube — try again');
  return (await r.json()) as T;
}

type VideoInfo = { id: string; title: string; channel: string; durationMs: number | null; embeddable: boolean };

async function videoDetails(ids: string[]): Promise<VideoInfo[]> {
  if (!ids.length) return [];
  const r = await youtube<{ items?: any[] }>('videos', { part: 'snippet,contentDetails,status', id: ids.join(',') });
  return (r.items ?? []).map((v) => ({
    id: v.id,
    title: String(v.snippet?.title ?? ''),
    channel: String(v.snippet?.channelTitle ?? ''),
    durationMs: isoDurationMs(v.contentDetails?.duration),
    embeddable: v.status?.embeddable !== false,
  }));
}

const UNWANTED = /\b(live|cover|karaoke|instrumental|slowed|reverb|sped ?up|8d|nightcore|reaction|lesson|tutorial|remix|mashup|lofi|lo-fi)\b/i;

/** Lower is better: the official audio upload with the same length as the Apple Music track wins. */
function score(v: VideoInfo, rank: number, song: { title: string; artist: string; durationMs: number | null }) {
  let s = rank * 4;
  if (song.durationMs && v.durationMs) s += Math.min(60, Math.abs(v.durationMs - song.durationMs) / 1000);
  else if (v.durationMs && v.durationMs > 12 * 60_000) s += 40;
  if (v.channel.endsWith(' - Topic')) s -= 25;
  if (/official (audio|video)|lyric/i.test(v.title)) s -= 8;
  if (v.channel.toLowerCase().includes(song.artist.toLowerCase().split(/[,&]/)[0].trim())) s -= 6;
  // "Live", "Remix"… only when the Apple title doesn't ask for it.
  const extra = v.title.match(UNWANTED)?.[0];
  if (extra && !new RegExp(`\\b${extra}\\b`, 'i').test(song.title)) s += 30;
  return s;
}

/** Finds (once, then remembers) the YouTube video that plays an Apple Music track in full. */
export async function videoForTrack(song: { trackId: number; title: string; artist: string; durationMs: number | null }) {
  const key = `itunes:${song.trackId}`;
  const cached = await one<{ video_id: string; duration_ms: number | null }>('SELECT video_id, duration_ms FROM song_videos WHERE track_key = $1', [key]);
  if (cached) return { videoId: cached.video_id, durationMs: cached.duration_ms };

  const found = await youtube<{ items?: { id?: { videoId?: string } }[] }>('search', {
    part: 'id',
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: '8',
    q: `${song.artist} ${song.title} audio`,
  });
  const ids = (found.items ?? []).map((i) => i.id?.videoId).filter((id): id is string => !!id && VIDEO_ID.test(id));
  const details = (await videoDetails(ids)).filter((v) => v.embeddable && (v.durationMs ?? 1) > 30_000);
  const rankOf = new Map(ids.map((id, i) => [id, i]));
  const best = details.sort((a, b) => score(a, rankOf.get(a.id)!, song) - score(b, rankOf.get(b.id)!, song))[0];
  if (!best) throw fail(404, 'Couldn’t find a full version of that song — try another');

  await query(
    `INSERT INTO song_videos (track_key, video_id, duration_ms) VALUES ($1, $2, $3)
     ON CONFLICT (track_key) DO UPDATE SET video_id = EXCLUDED.video_id, duration_ms = EXCLUDED.duration_ms`,
    [key, best.id, best.durationMs],
  );
  return { videoId: best.id, durationMs: best.durationMs };
}

/** The video id in a YouTube / YouTube Music link, or null. */
export function videoIdFromLink(text: string) {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ?? null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** A pasted YouTube link. Works without an API key (oEmbed); the length comes from the player then. */
export async function songFromVideo(videoId: string): Promise<PlayableSong> {
  const r = await fetch(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
    { signal: AbortSignal.timeout(8000) },
  ).catch(() => null);
  if (!r) throw fail(502, 'Couldn’t reach YouTube — try again');
  if (r.status === 401 || r.status === 403) throw fail(400, 'That video can’t be played outside YouTube');
  if (!r.ok) throw fail(404, 'That video doesn’t exist or is private');
  const info = (await r.json()) as { title?: string; author_name?: string };
  let durationMs: number | null = null;
  if (config.youtubeApiKey) durationMs = (await videoDetails([videoId]).catch(() => []))[0]?.durationMs ?? null;
  // "Artist - Title (Official Video)" → split it the way people expect.
  const raw = String(info.title ?? 'YouTube video');
  const dash = raw.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const author = String(info.author_name ?? '').replace(/ - Topic$/, '').replace(/VEVO$/, '');
  return {
    title: (dash ? dash[2] : raw).replace(/\s*[([](official|lyric|audio|video|hd|4k)[^)\]]*[)\]]/gi, '').trim().slice(0, 200) || raw.slice(0, 200),
    artist: (dash ? dash[1] : author).trim().slice(0, 200),
    artwork: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    videoId,
    durationMs,
  };
}
