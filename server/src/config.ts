const isProd = process.env.NODE_ENV === 'production';

function required(name: string, devFallback?: string): string {
  const v = process.env[name];
  if (v) return v;
  if (!isProd && devFallback !== undefined) return devFallback;
  throw new Error(`Missing required environment variable ${name}`);
}

/** Firebase service-account JSON for push notifications, given raw or base64-encoded. */
function firebaseAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return undefined;
  try {
    const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    if (json.project_id && json.client_email && json.private_key) {
      return { projectId: json.project_id as string, clientEmail: json.client_email as string, privateKey: json.private_key as string };
    }
  } catch {
    /* fall through */
  }
  console.error('[push] FIREBASE_SERVICE_ACCOUNT is not a valid service-account JSON — push is off');
  return undefined;
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:5433/postgres'),
  jwtSecret: required('JWT_SECRET', 'dev-only-secret-do-not-use-in-production'),
  clientOrigin: process.env.CLIENT_ORIGIN || undefined,
  firebase: firebaseAccount(),
  /** YouTube Data API key: finds the full-length video for each song added to a Chill Room. */
  youtubeApiKey: process.env.YOUTUBE_API_KEY?.trim() || undefined,
  turn: {
    url: process.env.TURN_URL || undefined,
    username: process.env.TURN_USERNAME || undefined,
    credential: process.env.TURN_CREDENTIAL || undefined,
  },
};
