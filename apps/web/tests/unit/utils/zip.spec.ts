import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { jszipMock, loadAsyncMock, makeZipEntry } = vi.hoisted(() => {
  const loadAsyncMock = vi.fn()
  const makeZipEntry = (buffer: ArrayBuffer) => ({
    async: vi.fn(async () => buffer)
  })
  const JSZipMock = vi.fn(function () {
    return { loadAsync: loadAsyncMock }
  })
  return { jszipMock: { default: JSZipMock }, loadAsyncMock, makeZipEntry }
})

vi.mock('jszip', () => jszipMock)

import { unzipGetFile } from '~~/app/utils/zip'

beforeEach(() => {
  loadAsyncMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('unzipGetFile', () => {
  it('zip 含匹配文件 → 返回 File[] 含一项，type 按扩展名得 mime', async () => {
    const buffer = new ArrayBuffer(8)
    loadAsyncMock.mockResolvedValueOnce({
      files: { 'image.png': makeZipEntry(buffer) }
    })
    const file = new File([new ArrayBuffer(0)], 'archive.zip', { type: 'application/zip' })
    const result = await unzipGetFile(file, /\.png$/)
    expect(result).toHaveLength(1)
    expect(result![0]?.name).toBe('image.png')
    expect(result![0]?.type).toBe('image/png')
  })

  it('zip 含 __MACOSX/ 路径文件 → 跳过', async () => {
    const buffer = new ArrayBuffer(8)
    loadAsyncMock.mockResolvedValueOnce({
      files: { '__MACOSX/image.png': makeZipEntry(buffer) }
    })
    const file = new File([new ArrayBuffer(0)], 'archive.zip', { type: 'application/zip' })
    const result = await unzipGetFile(file, /\.png$/)
    expect(result).toHaveLength(0)
  })

  it('zip 含 /._  隐藏文件 → 跳过', async () => {
    const buffer = new ArrayBuffer(8)
    loadAsyncMock.mockResolvedValueOnce({
      files: { 'subdir/._hidden.png': makeZipEntry(buffer) }
    })
    const file = new File([new ArrayBuffer(0)], 'archive.zip', { type: 'application/zip' })
    const result = await unzipGetFile(file, /\.png$/)
    expect(result).toHaveLength(0)
  })

  it('matchRule 不匹配的文件 → 跳过', async () => {
    const buffer = new ArrayBuffer(8)
    loadAsyncMock.mockResolvedValueOnce({
      files: { 'document.txt': makeZipEntry(buffer) }
    })
    const file = new File([new ArrayBuffer(0)], 'archive.zip', { type: 'application/zip' })
    const result = await unzipGetFile(file, /\.png$/)
    expect(result).toHaveLength(0)
  })

  it('zip 无匹配文件 → 返回空数组', async () => {
    loadAsyncMock.mockResolvedValueOnce({ files: {} })
    const file = new File([new ArrayBuffer(0)], 'archive.zip', { type: 'application/zip' })
    const result = await unzipGetFile(file, /\.png$/)
    expect(result).toHaveLength(0)
  })
})
