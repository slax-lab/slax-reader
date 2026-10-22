export type PdfAcquisitionResult = {kind: 'range'; begin: number; bytes: Uint8Array} | {kind: 'complete'; size: number};
export type PdfCompleteConsumer = (chunks: AsyncIterable<Uint8Array>, signal: AbortSignal, discard: () => void) => Promise<void | false>;
