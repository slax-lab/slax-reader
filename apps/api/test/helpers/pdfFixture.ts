/** Small real PDFs with a correct xref, without an external fixture dependency. */
export type PdfTextRun = { text: string; size: number; x: number; y: number; vertical?: boolean }
export function pdfFixture(
  texts: string[] = ['Hello PDF'],
  rotations: number[] = [],
  title?: string,
  author?: string,
  xmpTitle?: string,
  firstPage?: PdfTextRun[]
): Uint8Array<ArrayBuffer> {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${texts.length} /Kids [${texts.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  texts.forEach((text, index) => {
    const stream =
      firstPage && index === 0
        ? firstPage.map(run => `BT /F1 ${run.size} Tf ${run.vertical ? '0 1 -1 0' : '1 0 0 1'} ${run.x} ${run.y} Tm (${run.text.replace(/[()\\]/g, '\\$&')}) Tj ET`).join('\n')
        : text
          ? `BT /F1 20 Tf 30 170 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`
          : ''
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox ${firstPage ? '[0 0 595 842]' : '[-20 10 300 210]'} /Rotate ${rotations[index] ?? 0} /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`
    )
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })
  const pdfString = (value: string) =>
    /[^\x00-\x7f]/.test(value)
      ? `<FEFF${Array.from({ length: value.length }, (_, i) => value.charCodeAt(i).toString(16).padStart(4, '0')).join('')}>`
      : `(${value.replace(/[()\\]/g, '\\$&')})`
  const info = [title !== undefined ? `/Title ${pdfString(title)}` : '', author !== undefined ? `/Author ${pdfString(author)}` : ''].filter(Boolean).join(' ')

  if (info) objects.push(`<< ${info} >>`)
  const infoId = info ? objects.length : undefined
  const length = (value: string) => new TextEncoder().encode(value).length
  if (xmpTitle !== undefined) {
    const escaped = xmpTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escaped}</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>`
    objects[0] = `<< /Type /Catalog /Pages 2 0 R /Metadata ${objects.length + 1} 0 R >>`
    objects.push(`<< /Type /Metadata /Subtype /XML /Length ${length(xml)} >>\nstream\n${xml}\nendstream`)
  }
  let pdf = '%PDF-1.7\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(length(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = length(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${info ? `/Info ${infoId} 0 R ` : ''}>>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}
