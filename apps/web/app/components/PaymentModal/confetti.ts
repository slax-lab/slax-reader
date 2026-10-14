import confetti from 'canvas-confetti'

const randomInRange = (min: number, max: number) => {
  return Math.random() * (max - min) + min
}

const loadDuration = (duration: number, handler: (timeLeft: number) => void) => {
  const animationEnd = Date.now() + duration

  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now()

    if (timeLeft <= 0) {
      return clearInterval(interval)
    }

    handler(timeLeft)
  }, 250)
}

const star = (duration: number) => {
  const defaults = {
    spread: 360,
    ticks: 50,
    gravity: 0,
    decay: 0.94,
    startVelocity: 30,
    colors: ['FFE400', 'FFBD00', 'E89400', 'FFCA6C', 'FDFFB8'],
    zIndex: 9999
  }

  loadDuration(duration, (timeLeft: number) => {
    const particleCount = 50 * (timeLeft / duration)

    confetti({ ...defaults, particleCount, scalar: 1.2, shapes: ['star'], origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } })
    confetti({ ...defaults, particleCount, scalar: 0.75, shapes: ['circle'], origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } })
  })
}

const pride = (duration: number) => {
  const animationEnd = Date.now() + 3 * 1000

  // canvas-confetti API 只接受 hex 字符串，无法使用 CSS var()，hex 保留为合法例外
  const colors = ['#bb0000', '#16b998', '#ffffff']

  const defaults = {
    colors: colors,
    zIndex: 9999
  }

  setTimeout(() => {
    ;(function frame() {
      const timeLeft = animationEnd - Date.now()
      const particleCount = 3 * (timeLeft / duration)

      confetti({
        ...defaults,
        particleCount,
        angle: 60,
        spread: 55,
        origin: { x: 0 }
      })

      confetti({
        ...defaults,
        particleCount,
        angle: 120,
        spread: 55,
        origin: { x: 1 }
      })

      if (Date.now() < animationEnd) {
        requestAnimationFrame(frame)
      }
    })()
  }, 250)
}

const fireworks = (duration: number) => {
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 }

  loadDuration(duration, (timeLeft: number) => {
    const particleCount = 100 * (timeLeft / duration)
    confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } })
    confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } })
  })
}

export { fireworks, pride, star }
