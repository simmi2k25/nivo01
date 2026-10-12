import manifest from '../data/frames.json';

/** Profile frames (made by tools/slice_frames.py): each is drawn centred on the photo, `scale` times its size. */
export type FramePack = { id: string; name: string; frames: { id: string; scale: number }[] };

export const FRAME_PACKS = manifest.packs as FramePack[];
const SCALE = new Map(FRAME_PACKS.flatMap((p) => p.frames.map((f) => [f.id, f.scale] as const)));

export const frameUrl = (id: string) => `/frames/${id}.webp`;
export const isFrame = (id: string | null | undefined): id is string => !!id && SCALE.has(id);
/** How big the frame image is next to the photo. Slightly under the hole size so the ring overlaps the photo's edge. */
export const frameScale = (id: string) => (SCALE.get(id) ?? 1.4) * 0.96;
