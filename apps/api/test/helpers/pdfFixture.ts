/** Small real PDFs with a correct xref, without an external fixture dependency. */
export function pdfFixture(texts: string[] = ['Hello PDF'], rotations: number[] = [], title?: string, author?: string): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${texts.length} /Kids [${texts.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  texts.forEach((text, index) => {
    const stream = text ? `BT /F1 20 Tf 30 170 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET` : ''
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [-20 10 300 210] /Rotate ${rotations[index] ?? 0} /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`)
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })
  const info = [title !== undefined ? `/Title (${title.replace(/[()\\]/g, '\\$&')})` : '', author !== undefined ? `/Author (${author.replace(/[()\\]/g, '\\$&')})` : ''].filter(Boolean).join(' ')
  if (info) objects.push(`<< ${info} >>`)
  let pdf = '%PDF-1.7\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${info ? `/Info ${objects.length} 0 R ` : ''}>>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}
