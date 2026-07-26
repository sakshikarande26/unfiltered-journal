import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Photo, WeekId } from "../shared/types.js";
import { photosDir, thumbsDir } from "./store/paths.js";

export class NotAnImageError extends Error {}

const THUMB_WIDTH = 480;

/**
 * Decodes an upload, measures it, writes the full image and a thumbnail, and
 * returns the manifest entry.
 *
 * The server measures rather than trusting client-supplied dimensions: the
 * numbers end up in the index, and an index that disagrees with the pixels on
 * disk is exactly the drift the filesystem-as-source-of-truth rule exists to
 * prevent. Decoding also means a non-image upload is rejected here rather than
 * discovered later by whatever tries to render it.
 */
export async function storePhoto(
  dataDir: string,
  weekId: WeekId,
  position: number,
  bytes: Buffer,
): Promise<Photo> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    throw new NotAnImageError("upload is not a decodable image");
  }
  if (!meta.width || !meta.height) {
    throw new NotAnImageError("upload has no readable dimensions");
  }

  const stem = String(position).padStart(2, "0");
  const filename = `${stem}.jpg`;
  const thumbFilename = `${stem}.webp`;

  const full = await sharp(bytes).jpeg({ quality: 90 }).toBuffer();
  const thumb = await sharp(bytes)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp()
    .toBuffer();

  writeFileSync(join(photosDir(dataDir, weekId), filename), full);
  writeFileSync(join(thumbsDir(dataDir, weekId), thumbFilename), thumb);

  return {
    filename,
    thumbFilename,
    width: meta.width,
    height: meta.height,
    aiDescription: null,
  };
}
