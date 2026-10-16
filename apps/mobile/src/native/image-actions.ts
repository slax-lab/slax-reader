import {Directory, File, Paths} from 'expo-file-system';
import {Asset, requestPermissionsAsync} from 'expo-media-library';
import {shareAsync} from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import {imageExportType, stagedImageExpired, stagedImageName} from '../domain/image-export.ts';
import type {ImageActionPort} from '../reader/state/useImageActions.ts';

const STAGED_MAXIMUM_AGE_MS = 10 * 60 * 1000;
export class ImagePermissionDeniedError extends Error {name = 'ImagePermissionDeniedError';}

/** Copies an app-owned cached image to a correctly typed temporary file; the original offline resource is never handed out. */
async function stage(uri: string) {
  const source = new File(uri);
  if (!source.exists) throw new Error('Image is unavailable');
  const type = imageExportType((await source.bytes()).subarray(0, 32));
  if (!type) throw new Error('Unsupported image format');
  const directory = new Directory(Paths.cache, 'image-exports'), now = Date.now();
  if (directory.exists) {
    for (const entry of directory.list()) if (entry instanceof File && stagedImageExpired(entry.name, now, STAGED_MAXIMUM_AGE_MS)) entry.delete();
  } else directory.create({intermediates: true});
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
    // The share sheet may still read the copy after it resolves; stale copies are pruned on the next export.
    await shareAsync(file.uri, {mimeType: type.mimeType, UTI: type.uti});
  },
  feedback() {void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});},
  isPermissionDenied: error => error instanceof ImagePermissionDeniedError,
};
