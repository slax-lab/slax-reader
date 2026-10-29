import type {PdfDescriptor} from '@slax-reader/contracts/pdf';

export interface FixturePdfPlan {bookmarkId: string; document: 'eight-pages' | 'thirteen-pages' | 'long-pages'; prepare?: 'complete'}
export interface FixturePdf {bytes: Uint8Array; descriptor: PdfDescriptor}
export interface FixturePdfCounts {metadataRequests: number; rangeRequests: number; bytesServed: number; offlineRequests: number; rejectedRequests: number}

/** Opaque, stable server-style identity for a synthetic document; fixtures never hash content. */
export function fixtureDocumentId(document: FixturePdfPlan['document']): string {
  return [...new TextEncoder().encode(`slax-fixture:${document}`)].map(byte => byte.toString(16).padStart(2, '0')).join('').padEnd(64, '0').slice(0, 64);
}

export function createFixturePdf(document: FixturePdfPlan['document']): FixturePdf {
  if (document !== 'eight-pages' && document !== 'thirteen-pages' && document !== 'long-pages') throw new Error('Unknown prepared PDF fixture');
  const pages = document === 'eight-pages' ? 8 : document === 'thirteen-pages' ? 13 : 30;
  const objects: string[] = [], pageIds = Array.from({length: pages}, (_, index) => 4 + index * 2);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Count ${pages} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  for (let page = 1; page <= pages; page++) {
    const lines = [`Slax PDF fixture - page ${page} of ${pages}`, 'Alpha selectable PDF text. Highlight this sentence.', 'A deterministic document for range cache and page restoration.', `Page ${page} selection anchor: violet river ${page}.`];
    let stream = 'BT /F1 18 Tf 48 730 Td 26 TL\n' + lines.map((line, index) => `${index ? 'T* ' : ''}(${line}) Tj`).join('\n') + '\nET\n';
    stream += `%${' fixture-padding'.repeat(2200)}\n`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate ${page === 3 ? 90 : 0} /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[page - 1]! + 1} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  }
  let source = '%PDF-1.4\n', offsets = [0];
  for (const [index, object] of objects.entries()) {offsets.push(source.length); source += `${index + 1} 0 obj\n${object}\nendobj\n`;}
  const xref = source.length;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new TextEncoder().encode(source);
  return {bytes, descriptor: {url: '', filename: `${document}.pdf`, size: bytes.length, document_id: fixtureDocumentId(document), source: 'upload', text_status: 'ready', pages}};
}

export function prepareFixturePdfs(plans: FixturePdfPlan[] = []): Map<string, FixturePdf> {
  const result = new Map<string, FixturePdf>();
  for (const plan of plans) {
    if (!/^[a-zA-Z0-9_-]+$/.test(plan.bookmarkId) || result.has(plan.bookmarkId)) throw new Error('Invalid prepared PDF bookmark');
    const value = createFixturePdf(plan.document);
    value.descriptor.url = `/v1/bookmark/pdf?bookmark_uid=${encodeURIComponent(plan.bookmarkId)}`;
    result.set(plan.bookmarkId, value);
  }
  return result;
}
