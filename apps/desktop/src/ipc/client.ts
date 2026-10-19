import { invoke, Channel } from "@tauri-apps/api/core";
import type {
  AuthState,
  BuildInfo,
  BookmarkAction,
  Bookmark,
  LibrarySnapshot,
  LibraryUpdate,
  ReaderDocument,
  Annotation,
  Selection,
  Preferences,
  SystemState,
  AiChunk,
  ShareSettings,
  Subscription,
  UpdateInfo,
} from "./generated";
const call = <T>(command: string, args: Record<string, unknown> = {}) => {
  const capability = (window as Window & { __SLAX_IPC_CAPABILITY__?: string })
    .__SLAX_IPC_CAPABILITY__;
  return invoke<T>(command, args, {
    headers: { "x-slax-main": capability ?? "" },
  });
};
export const ipc = {
  build: () => call<BuildInfo>("settings_build"),
  auth: () => call<AuthState>("auth_state"),
  login: () => call<void>("auth_begin"),
  cancelLogin: () => call<void>("auth_cancel"),
  pending: (generation: string) =>
    call<number>("auth_pending_writes", { generation }),
  signOut: (generation: string, discard: boolean) =>
    call<void>("auth_sign_out", { generation, discard }),
  snapshot: (generation: string, view: string, tags: string[]) =>
    call<LibrarySnapshot>("library_snapshot", { generation, view, tags }),
  search: (
    generation: string,
    view: string,
    query: string,
    cloud: boolean,
    requestId: string,
    tags: string[],
  ) =>
    call<Bookmark[]>("library_search", {
      generation,
      view,
      query,
      cloud,
      requestId,
      tags,
    }),
  watch: (
    generation: string,
    view: string,
    receive: (value: LibraryUpdate) => void,
    tags: string[],
  ) => {
    const channel = new Channel<LibraryUpdate>();
    channel.onmessage = receive;
    return call<string>("library_watch", { generation, view, channel, tags });
  },
  unwatch: (watchId: string) => call<void>("library_unwatch", { watchId }),
  add: (generation: string, url: string) =>
    call<string>("library_add", { generation, url }),
  mutate: (generation: string, id: string, action: BookmarkAction) =>
    call<void>("library_mutate", { generation, id, action }),
  tag: (generation: string, name: string) =>
    call<string>("library_tag_create", { generation, name }),
  select: (generation: string, id: string | null) =>
    call<void>("library_select", { generation, id }),
  original: (generation: string, id: string) =>
    call<void>("library_original", { generation, id }),
  context: (generation: string, id: string) =>
    call<void>("library_context", { generation, id }),
  open: (generation: string, id: string) =>
    call<ReaderDocument>("reader_open", { generation, id }),
  close: (generation: string, handle: string) =>
    call<void>("reader_close", { generation, handle }),
  marks: (generation: string, handle: string) =>
    call<Annotation[]>("reader_marks", { generation, handle }),
  marksWatch: (
    generation: string,
    handle: string,
    receive: (value: Annotation[]) => void,
  ) => {
    const channel = new Channel<Annotation[]>();
    channel.onmessage = receive;
    return call<string>("reader_marks_watch", { generation, handle, channel });
  },
  marksUnwatch: (watchId: string) =>
    call<void>("reader_marks_unwatch", { watchId }),
  mark: (
    generation: string,
    handle: string,
    kind: number,
    selection: Selection | null,
    comment: string,
    parent: string | null = null,
  ) =>
    call<string>("reader_mark_add", {
      generation,
      handle,
      kind,
      selection,
      comment,
      parent,
    }),
  deleteMark: (generation: string, handle: string, mark: string) =>
    call<void>("reader_mark_delete", { generation, handle, mark }),
  progress: (generation: string, handle: string, progress: number) =>
    call<void>("reader_progress", { generation, handle, progress }),
  copy: (generation: string, handle: string, text: string) =>
    call<void>("reader_copy", { generation, handle, text }),
  external: (generation: string, handle: string, url: string) =>
    call<void>("reader_external", { generation, handle, url }),
  pdfProgress: (generation: string, handle: string, position: number) =>
    call<void>("pdf_progress", { generation, handle, position }),
  range: (
    generation: string,
    handle: string,
    documentId: string,
    begin: number,
    end: number,
  ) =>
    call<ArrayBuffer>("pdf_range", {
      generation,
      handle,
      documentId,
      begin,
      end,
    }),
  preferences: () => call<Preferences>("settings_get"),
  savePreferences: (preferences: Preferences) =>
    call<void>("settings_save", { preferences }),
  system: () => call<SystemState>("settings_system"),
  updateCheck: () => call<UpdateInfo>("settings_update_check"),
  updateInstall: () => call<void>("settings_update_install"),
  product: <T = unknown>(
    generation: string,
    operation: string,
    input: Record<string, unknown> = {},
  ) => call<T>("settings_product", { generation, operation, input }),
  browser: (generation: string, kind: "subscription" | "profile") =>
    call<void>("settings_browser", { generation, kind }),
  capture: (generation: string) =>
    call<string | null>("library_capture", { generation }),
  clipboard: (generation: string) =>
    call<string | null>("library_clipboard", { generation }),
  readerContext: (
    generation: string,
    handle: string,
    selection: Selection | null,
    url: string | null,
  ) => call<void>("reader_context", { generation, handle, selection, url }),
  images: (generation: string, handle: string) =>
    call<string[]>("reader_images", { generation, handle }),
  share: (
    generation: string,
    handle: string,
    operation: "get" | "save",
    input?: Partial<ShareSettings>,
  ) =>
    call<ShareSettings>("reader_share", {
      generation,
      handle,
      operation,
      input: input ? { ...input, url: "" } : null,
    }),
  download: (generation: string, handle: string) =>
    call<void>("reader_download", { generation, handle }),
  rssOpen: (generation: string, id: string) =>
    call<ReaderDocument>("rss_open", { generation, id }),
  clearCache: (generation: string) =>
    call<void>("settings_clear_cache", { generation }),
  subscription: (generation: string) =>
    call<Subscription>("settings_subscription", { generation }),
  event: (generation: string, name: string) =>
    call<void>("settings_event", { generation, name }),
  importPdf: (generation: string) =>
    call<string | null>("pdf_import", { generation }),
  ai: (
    generation: string,
    handle: string,
    kind: "overview" | "outline",
    force: boolean,
    receive: (value: AiChunk) => void,
  ) => {
    const channel = new Channel<AiChunk>();
    channel.onmessage = receive;
    return call<string>("ai_stream", {
      generation,
      handle,
      kind,
      force,
      channel,
    });
  },
};
