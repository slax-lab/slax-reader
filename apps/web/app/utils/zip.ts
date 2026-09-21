const unzipGetFile = async (file: File, matchRule: RegExp): Promise<File[] | undefined> => {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const fileContent = await zip.loadAsync(file)
  console.log(`fileContent.files: ${Object.keys(fileContent.files)}`)

  const files: File[] = []
  for (const [filename, zipEntry] of Object.entries(fileContent.files)) {
    if (filename.startsWith('__MACOSX/') || filename.includes('/._')) continue
    if (!matchRule.test(filename)) continue

    const content = await zipEntry.async('arraybuffer')
    console.log(`find ${filename} success`)
    files.push(new File([content], filename, { type: getMimeType(filename) }))
  }
  return files
}

const getMimeType = (fileName: string): string => {
  const extension = fileName.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    txt: 'text/plain',
    json: 'application/json',
    xml: 'application/xml',
    csv: 'text/csv',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  return mimeTypes[extension || ''] || 'application/octet-stream'
}

export { unzipGetFile }
