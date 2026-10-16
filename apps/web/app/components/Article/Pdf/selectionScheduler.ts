/**
 * Decides when a PDF text selection may open its action menu.
 *
 * The menu closes on any click outside it, and releasing the mouse after a drag emits a click on the
 * text layer. A timer that only counts quiet time can fire while the button is still held (the reader
 * paused mid-drag), so the menu mounts and that very release click dismisses it. While the pointer is
 * pressed nothing is scheduled; the capture runs one debounce after release, once the click has passed.
 */
export interface SelectionScheduler {
  /** A selection may have changed (selectionchange, keyboard). Ignored while the pointer is pressed. */
  queue: (event?: Event) => void
  /** The pointer went down: cancel any pending capture and hold off until release. */
  press: () => void
  /** The pointer came up or was cancelled: schedule a capture, anchored to the release event if given. */
  release: (event?: Event) => void
  dispose: () => void
}

export function createSelectionScheduler(run: (event?: Event) => void, delay = 180): SelectionScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Event | undefined
  let pressed = false

  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const schedule = () => {
    cancel()
    timer = setTimeout(() => {
      timer = undefined
      const event = pending
      pending = undefined
      run(event)
    }, delay)
  }

  return {
    queue(event) {
      if (event) pending = event
      if (pressed) return
      schedule()
    },
    press() {
      pressed = true
      pending = undefined
      cancel()
    },
    release(event) {
      pressed = false
      if (event) pending = event
      schedule()
    },
    dispose() {
      pressed = false
      pending = undefined
      cancel()
    }
  }
}
