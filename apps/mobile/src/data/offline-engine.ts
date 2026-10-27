import type {PdfDescriptor} from '@slax-reader/contracts/pdf';
import {ApiError} from './api.ts';
import {DataTransportError, type DataErrorStage} from './transport-errors.ts';
import {CredentialsUnavailableError} from '../domain/credential-readiness.ts';

export interface OfflineScope {owner: string; scope: string; origin: string; directory: string; userAgent: string; clientType: 'ios' | 'android'; clientVersion: string; protectedHosts?: string[]; imageProxyOrigins?: string[]}
export interface OfflineTask {key: string; id: string; collectionOwner?: string; kind: 'article' | 'pdf'; manual: boolean; version: string}
export interface OfflinePlan {revision: number; upsert: OfflineTask[]; remove: string[]}
export type OfflineState = 'downloading' | 'complete' | 'failed' | 'denied' | 'invalidated' | 'evicted';
export interface OfflineStatusItem {key: string; state: OfflineState; manual: boolean; retryAt?: number; code?: string}
export interface OfflineStatusEvent {owner: string; items: OfflineStatusItem[]}
export interface OfflineCredentialRejected {owner: string; generation: number}
export interface OfflineOpenResult {adopted: string[]; dropped: string[]; migrationPending: boolean}
export interface OfflineContentRequest {key: string; id: string; collectionOwner?: string; requestId: string}
export interface OfflinePdfStatus {downloadedBytes: number; totalBytes: number; complete: boolean}
export type OfflineUsageCategory = 'article' | 'images';

export interface SlaxOfflineEngineNative {
  open(scope: OfflineScope): Promise<OfflineOpenResult>;
  commitMigration(owner: string): Promise<void>;
  suspend(owner: string): Promise<void>;
  resume(owner: string): void;
  close(owner: string): Promise<void>;
  setCredential(owner: string, credential: {generation: number; token: string} | null): void;
  setConditions(owner: string, conditions: {online: boolean; downloadImages: boolean}): void;
  applyPlan(owner: string, plan: OfflinePlan): void;
  evict(owner: string, keys: string[]): Promise<string[]>;
  protect(owner: string, key: string): string;
  release(owner: string, token: string): void;
  readArticle(owner: string, key: string): Promise<string | null>;
  fetchArticle(owner: string, request: OfflineContentRequest & {force: boolean}): Promise<string>;
  pdfMetadata(owner: string, request: OfflineContentRequest & {allowNetwork: boolean}): Promise<PdfDescriptor>;
  readPdfRange(owner: string, request: OfflineContentRequest & {documentId: string; size: number; begin: number; end: number}): Promise<Uint8Array>;
  pdfStatus(owner: string, key: string): Promise<OfflinePdfStatus>;
  cancel(owner: string, requestId: string): void;
  usage(owner: string, keys: string[]): Promise<{article: number; images: number}>;
  clear(owner: string, keys: string[], categories: OfflineUsageCategory[]): Promise<string[]>;
}
export type OfflineEngineSubscription = {remove(): void};
export interface OfflineEngine extends SlaxOfflineEngineNative {
  addListener(event: 'onStatus', listener: (event: OfflineStatusEvent) => void): OfflineEngineSubscription;
  addListener(event: 'onCredentialRejected', listener: (event: OfflineCredentialRejected) => void): OfflineEngineSubscription;
}

export class OfflineEngineUnavailableError extends Error {
  constructor() {super('Offline engine unavailable'); this.name = 'OfflineEngineUnavailableError';}
}
/** Hosts without the native engine (unit hosts, older native builds) cache nothing and reject network reads explicitly. */
export function unavailableOfflineEngine(): OfflineEngine {
  const unavailable = () => Promise.reject(new OfflineEngineUnavailableError());
  return {
    open: async () => ({adopted: [], dropped: [], migrationPending: false}), commitMigration: async () => {}, suspend: async () => {}, resume() {}, close: async () => {},
    setCredential() {}, setConditions() {}, applyPlan() {}, evict: async () => [], protect: (_owner, key) => key, release() {},
    readArticle: async () => null, fetchArticle: unavailable, pdfMetadata: unavailable, readPdfRange: unavailable,
    pdfStatus: async () => ({downloadedBytes: 0, totalBytes: 0, complete: false}), cancel() {},
    usage: async () => ({article: 0, images: 0}), clear: async () => [],
    addListener: () => ({remove() {}}),
  };
}

const PDF_TEXT_STATUS = ['pending', 'ready', 'empty', 'failed'];
/** Native descriptors carry no transport URL; the Reader keeps the existing relative URL contract. `document_id` stays opaque. */
export function offlinePdfDescriptor(id: string, value: PdfDescriptor): PdfDescriptor {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.size) || value.size < 1 || typeof value.document_id !== 'string' || !value.document_id || value.document_id.length > 256 ||
    typeof value.filename !== 'string' || !['url', 'upload'].includes(value.source) || !PDF_TEXT_STATUS.includes(value.text_status) ||
    (value.pages != null && (!Number.isSafeInteger(value.pages) || value.pages < 1))) throw new ApiError(502, 'Invalid PDF metadata', undefined, {stage: 'pdf-metadata', code: 'pdf_metadata_invalid'});
  const {pages, url: _url, ...descriptor} = value;
  return {...descriptor, ...(pages ? {pages} : {}), url: `/v1/bookmark/pdf?bookmark_uid=${encodeURIComponent(id)}`};
}

const PROTOCOL_CODES = ['pdf_metadata_invalid', 'pdf_identity_mismatch', 'pdf_range_invalid', 'pdf_length_invalid', 'pdf_stream_unavailable', 'pdf_body_invalid', 'offline_integrity_invalid'] as const;
const HTTP_CODES: Record<string, number> = {http_unauthorized: 401, http_forbidden: 403, http_not_found: 404, http_precondition_failed: 412, http_range_not_satisfiable: 416, http_rate_limited: 429, http_server_error: 500, http_error: 400};
/**
 * Maps native rejection codes onto the errors the Reader already classifies. Native engines use the JavaScript
 * `DataErrorCode` names (`http_not_found`, `network_unavailable`, `request_timeout`, `operation_cancelled`, `pdf_*`);
 * `HTTP_<status>` / `NETWORK` / `TIMEOUT` / `CANCELLED` are also accepted. A `(<status>)` suffix in the message refines the status.
 */
export function offlineEngineError(error: unknown, stage: DataErrorStage): unknown {
  if (!error || typeof error !== 'object') return error;
  const code = 'code' in error ? String(error.code).toLowerCase().replace(/^err_/, '') : '';
  const reported = Number(/\((\d{3})\)/.exec('message' in error ? String(error.message) : '')?.[1]);
  const status = /^http_(\d{3})$/.exec(code)?.[1] ? Number(/^http_(\d{3})$/.exec(code)![1]) : HTTP_CODES[code] !== undefined ? (Number.isInteger(reported) && reported >= 400 ? reported : HTTP_CODES[code]!) : 0;
  if (status) return new ApiError(status, `Request failed (${status})`, undefined, {stage});
  if (['network', 'offline', 'network_unavailable'].includes(code)) return new DataTransportError('network', stage);
  if (code === 'timeout' || code === 'request_timeout') return new DataTransportError('timeout', stage);
  if (['cancelled', 'canceled', 'aborted', 'operation_cancelled', 'inactive'].includes(code)) return Object.assign(new Error('Offline request cancelled'), {name: 'AbortError'});
  if (code === 'credential_unavailable') return new CredentialsUnavailableError();
  if (code === 'session_changed') return Object.assign(new Error('The account session changed'), {name: 'SessionChangedError'});
  if (code === 'pdf_metadata_failed' && Number.isInteger(reported)) return new ApiError(reported, 'PDF metadata request failed', undefined, {stage});
  const protocol = PROTOCOL_CODES.find(value => value === code);
  if (protocol) {
    const diagnostic = protocol === 'offline_integrity_invalid' ? 'pdf_body_invalid' : protocol;
    return new ApiError(protocol === 'pdf_identity_mismatch' ? 412 : 502, 'Invalid PDF response', undefined, {stage, code: diagnostic});
  }
  return error;
}
