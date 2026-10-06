const isProd = process.env.NODE_ENV === 'production';

function required(name: string, devFallback?: string): string {
  const v = process.env[name];
  if (v) return v;
  if (!isProd && devFallback !== undefined) return devFallback;
  throw new Error(`Missing required environment variable ${name}`);
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:5433/postgres'),
  jwtSecret: required('JWT_SECRET', 'dev-only-secret-do-not-use-in-production'),
  clientOrigin: process.env.CLIENT_ORIGIN || undefined,
  turn: {
    url: process.env.TURN_URL || undefined,
    username: process.env.TURN_USERNAME || undefined,
    credential: process.env.TURN_CREDENTIAL || undefined,
  },
};
