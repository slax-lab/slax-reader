export interface MouseTrackOptions {
  mouseTrackingHandler?: () => void
  touchTrackingHandler?: () => void
  wheelTrackingHandler?: () => void
}

export class MouseTrack {
  private mousePos = {
    x: 0,
    y: 0
  }

  options: MouseTrackOptions

  constructor(options: MouseTrackOptions) {
    this.options = options
  }

  destruct() {
    this.mouseTrack(false)
    this.touchTrack(false)
    this.wheelTrack(false)
  }

  mouseTrack(enable: boolean) {
    if (enable) {
      document.addEventListener('mousemove', this.mouseMoveHandler)
    } else {
      document.removeEventListener('mousemove', this.mouseMoveHandler)
    }
  }

  touchTrack(enable: boolean) {
    if (enable) {
      document.addEventListener('touchmove', this.touchMoveHandler)
    } else {
      document.removeEventListener('touchmove', this.touchMoveHandler)
    }
  }

  wheelTrack(enable: boolean) {
    if (enable) {
      window.addEventListener('wheel', this.wheelHandler)
    } else {
      window.removeEventListener('wheel', this.wheelHandler)
    }
  }

  private mouseMoveHandler = (event: MouseEvent) => {
    this.mousePos.x = event.clientX
    this.mousePos.y = event.clientY

    if (this.options.mouseTrackingHandler) {
      this.options.mouseTrackingHandler()
    }
  }

  private touchMoveHandler = (event: TouchEvent) => {
    const touches = event.touches
    if (touches.length === 0) {
      return
    }

    const touch = event.touches[0]
    if (!touch) return
    this.mousePos.x = touch.clientX
    this.mousePos.y = touch.clientY

    if (this.options.touchTrackingHandler) {
      this.options.touchTrackingHandler()
    }
  }

  wheelHandler = () => {
    if (this.options.wheelTrackingHandler) {
      this.options.wheelTrackingHandler()
    }
  }

  get lastMousePosition() {
    return this.mousePos
  }
}
