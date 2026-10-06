import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export const COOKIE = 'nivo_session';
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

declare global {
  namespace Express {
    interface Request {
      userId: number;
    }
  }
}

export function signSession(userId: number) {
  return jwt.sign({ uid: userId }, config.jwtSecret, { expiresIn: '30d' });
}

export function verifySession(token: string | undefined): number | null {
  if (!token) return null;
  try {
    const p = jwt.verify(token, config.jwtSecret) as { uid?: number };
    return typeof p.uid === 'number' ? p.uid : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, userId: number, remember: boolean) {
  res.cookie(COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    ...(remember ? { maxAge: THIRTY_DAYS } : {}),
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const uid = verifySession(req.cookies?.[COOKIE]);
  if (!uid) return res.status(401).json({ error: 'Please log in' });
  req.userId = uid;
  next();
}

/** Reads the session cookie out of a raw Cookie header (used by Socket.IO). */
export function userIdFromCookieHeader(header: string | undefined): number | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return verifySession(decodeURIComponent(v.join('=')));
  }
  return null;
}
