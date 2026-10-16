import {Directory, File, Paths} from 'expo-file-system';
import {Asset, requestPermissionsAsync} from 'expo-media-library';
import {shareAsync} from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import {imageExportType, stagedImageExpired, stagedImageName} from '../domain/image-export.ts';
import type {ImageActionPort} from '../reader/state/useImageActions.ts';

const STAGED_MAXIMUM_AGE_MS = 10 * 60 * 1000;
export class ImagePermissionDeniedError extends Error {name = 'ImagePermissionDeniedError';}

const stagedDirectory = () => new Directory(Paths.cache, 'image-exports');
/** Deletes only staged copies older than the share window; a copy a share sheet may still be reading is kept. */
function pruneStagedImages(now = Date.now()) {
  const directory = stagedDirectory();
  if (!directory.exists) return;
  for (const entry of directory.list()) {
    if (entry instanceof File && stagedImageExpired(entry.name, now, STAGED_MAXIMUM_AGE_MS)) {try {entry.delete();} catch {}}
  }
}

/** Copies an app-owned cached image to a correctly typed temporary file; the original offline resource is never handed out. */
async function stage(uri: string) {
  const source = new File(uri);
  if (!source.exists) throw new Error('Image is unavailable');
  const type = imageExportType((await source.bytes()).subarray(0, 32));
  if (!type) throw new Error('Unsupported image format');
  const directory = stagedDirectory(), now = Date.now();
  pruneStagedImages(now);
  if (!directory.exists) directory.create({intermediates: true});
  const target = new File(directory, stagedImageName(now, Math.random().toString(36).slice(2), type));
  await source.copy(target);
  return {file: target, type};
}

export const imageActionPort: ImageActionPort = {
  async save(uri) {
    const permission = await requestPermissionsAsync(true);
    if (!permission.granted) throw new ImagePermissionDeniedError('Photo library access was denied');
    const {file} = await stage(uri);
    try {await Asset.create(file.uri);}
    finally {try {file.delete();} catch {}}
  },
  async share(uri) {
    const {file, type} = await stage(uri);
    // The share sheet may still read the copy after it resolves, so only older copies are pruned now.
    try {await shareAsync(file.uri, {mimeType: type.mimeType, UTI: type.uti});}
    finally {pruneStagedImages();}
  },
  prune() {pruneStagedImages();},
  feedback() {void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});},
  isPermissionDenied: error => error instanceof ImagePermissionDeniedError,
};
