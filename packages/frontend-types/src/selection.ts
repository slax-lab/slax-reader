/**
 * Types used while selecting and rendering a mark in the browser.
 *
 * These are intentionally separate from the API mark DTOs.  A browser
 * selection is addressed by a CSS/XPath-like `path` and offsets within that
 * node; the API package also contains a newer wire representation using
 * `xpath`, `start_offet`, and `end_offset`.  Keeping the browser shape here
 * prevents a type alias from silently changing the JSON sent by the existing
 * selection implementation.
 */
export type SelectionMarkPathItem =
  | { type: 'text'; path: string; start: number; end: number }
  | { type: 'image'; path: string }

export interface SelectionMarkPathApprox {
  exact: string
  prefix: string
  suffix: string
  position_start: number
  position_end: number
  raw_text?: string
}

export interface SelectionMarkContent {
  type: 'text' | 'image'
  text: string
  src: string
}
