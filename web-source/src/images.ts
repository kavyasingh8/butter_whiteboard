import { asArray } from './board';
import type { Settings } from './types';

const encoder = new TextEncoder();

/** Mirrors the server's link check so players get feedback before sending. */
export function isAllowedImageUrl(url: string, images: Settings['images']) {
  // The server counts bytes, not characters.
  if (encoder.encode(url).length > images.maxUrlLength || /[\s"'<>\\`]/.test(url)) return false;
  // Same host characters as the server accepts: letters, digits, dots and dashes.
  const match = /^https:\/\/([A-Za-z0-9.-]+)\//.exec(url);
  if (!match) return false;
  const host = match[1].toLowerCase();
  return asArray(images.domains).some((domain) => host === domain || host.endsWith(`.${domain}`));
}
