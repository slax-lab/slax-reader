/** Exportable image formats recognised from file signatures; cached article images may have arbitrary names. */
export interface ImageExportType {extension: string; mimeType: string; uti: string}

const types: Record<'jpg' | 'png' | 'gif' | 'webp' | 'heic' | 'avif' | 'bmp', ImageExportType> = {
  jpg: {extension: 'jpg', mimeType: 'image/jpeg', uti: 'public.jpeg'},
  png: {extension: 'png', mimeType: 'image/png', uti: 'public.png'},
  gif: {extension: 'gif', mimeType: 'image/gif', uti: 'com.compuserve.gif'},
  webp: {extension: 'webp', mimeType: 'image/webp', uti: 'org.webmproject.webp'},
  heic: {extension: 'heic', mimeType: 'image/heic', uti: 'public.heic'},
  avif: {extension: 'avif', mimeType: 'image/avif', uti: 'public.avif'},
  bmp: {extension: 'bmp', mimeType: 'image/bmp', uti: 'com.microsoft.bmp'},
};

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));

/** Returns null for anything that is not a raster image the platform photo library can store. */
export function imageExportType(bytes: Uint8Array): ImageExportType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return types.jpg;
  if (bytes.length >= 8 && ascii(bytes, 1, 3) === 'PNG' && bytes[0] === 0x89) return types.png;
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return types.gif;
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return types.webp;
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand === 'avif' || brand === 'avis') return types.avif;
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return types.heic;
  }
  if (bytes.length >= 2 && ascii(bytes, 0, 2) === 'BM') return types.bmp;
  return null;
}

/** Staged export names carry their creation time so abandoned share copies can be pruned without file metadata. */
export function stagedImageName(now: number, nonce: string, type: ImageExportType): string {
  return `image-${now}-${nonce.replace(/[^a-z0-9]/gi, '').slice(0, 16) || '0'}.${type.extension}`;
}
export function stagedImageExpired(name: string, now: number, maximumAgeMs: number): boolean {
  const created = /^image-(\d+)-[a-z0-9]+\.[a-z]+$/i.exec(name)?.[1];
  return created !== undefined && now - Number(created) > maximumAgeMs;
}
