import type { Selection } from "./ipc/generated";
export interface FramePayload {
  type: string;
  selection?: unknown;
  rect?: unknown;
  url?: unknown;
  value?: unknown;
  event?: unknown;
  kind?: unknown;
  id?: unknown;
  begin?: unknown;
  end?: unknown;
  position?: unknown;
}
export function frameMessage(
  event: MessageEvent,
  source: Window | null,
  pageId: string,
): FramePayload | null {
  if (
    !source ||
    event.source !== source ||
    !event.data ||
    typeof event.data !== "object"
  )
    return null;
  const value = event.data;
  if (
    value.pageId !== pageId ||
    !["slax-reader", "slax-pdf"].includes(value.channel)
  )
    return null;
  // Frequent small messages skip the serialization bound; only payloads that can carry text are measured.
  const compact =
    value.channel === "slax-pdf"
      ? ["position", "range", "contextMenu"].includes(value.kind)
      : ["progress", "domReady", "textDeselected", "result"].includes(
          value.payload?.type,
        );
  if (!compact)
    try {
      if (JSON.stringify(value).length > 1024 * 1024) return null;
    } catch {
      return null;
    }
  if (value.channel === "slax-pdf") return value as FramePayload;
  const payload = value.payload;
  return payload &&
    typeof payload === "object" &&
    typeof payload.type === "string"
    ? (payload as FramePayload)
    : null;
}
export function selectionFrom(
  value: unknown,
  rectValue: unknown,
): Selection | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>,
    r = rectValue as Record<string, unknown> | null;
  if (
    typeof s.text !== "string" ||
    !s.text ||
    s.text.length > 100000 ||
    !Array.isArray(s.source) ||
    s.source.length > 1000 ||
    !r ||
    !["x", "y", "width", "height"].every(
      (k) => typeof r[k] === "number" && Number.isFinite(r[k]),
    )
  )
    return null;
  if (
    !s.source.every(
      (item) =>
        item &&
        typeof item === "object" &&
        ["text", "image", "pdf"].includes(item.type),
    )
  )
    return null;
  return {
    text: s.text,
    source: JSON.stringify(s.source),
    approxSource: JSON.stringify(s.approx_source ?? {}),
    rect: {
      x: r.x as number,
      y: r.y as number,
      width: r.width as number,
      height: r.height as number,
    },
  };
}
