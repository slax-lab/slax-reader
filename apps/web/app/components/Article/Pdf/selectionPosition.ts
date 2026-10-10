interface Point { x: number; y: number }
interface Box { left: number; top: number; width: number; height: number }

/** Keep pointer/selection actions beside their anchor and inside the usable viewport. */
export function placeSelectionMenu(anchor: Point, menu: { width: number; height: number }, viewport: Box): Point {
  const gap = 12
  const right = viewport.left + viewport.width - menu.width
  const bottom = viewport.top + viewport.height - menu.height
  const above = anchor.y - menu.height - gap
  return {
    x: Math.max(viewport.left, Math.min(anchor.x - menu.width / 4, right)),
    y: Math.max(viewport.top, Math.min(above >= viewport.top ? above : anchor.y + gap, bottom))
  }
}
