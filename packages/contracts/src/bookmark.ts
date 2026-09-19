/** Shared bookmark shapes for the apps that read and write the library. */
export interface BookmarkSummary {
  id: string;
  url: string;
  title: string;
  savedAt: string;
}

/** Payload the reader sends when saving a page. */
export interface SaveBookmarkRequest {
  url: string;
  title: string;
  /** Absent when the page was saved without highlighting anything. */
  highlight?: string;
}
