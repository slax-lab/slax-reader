export interface ImageResourceRequest {directory: string; key: string; url: string; owner: string; allowNetwork: boolean; strict: boolean}
export interface ImageResource {uri: string; size: number; mime?: string}
export type ImageResourceResolver = (request: ImageResourceRequest, signal?: AbortSignal) => Promise<ImageResource | null>;
