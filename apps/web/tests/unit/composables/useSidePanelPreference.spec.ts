// useSidePanelPreference 单测：详情页右侧面板是否自动展开的本地偏好
import { SIDE_PANEL_AUTO_OPEN_KEY, SNAPSHOT_CONTENT_WIDTH, useSidePanelPreference } from '~/composables/useSidePanelPreference'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PANEL_W = 440
const WIDE = SNAPSHOT_CONTENT_WIDTH + PANEL_W // 1260：面板不推挤正文的最小宽度
const NARROW = WIDE - 1

// nuxt 测试环境里 localStorage 是个没有 Storage 方法的空对象（同 upstream BookmarkCell.spec 的说明），
// 换成内存版，每个用例重置。
const createMemoryStorage = () => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    }
  }
}

describe('useSidePanelPreference', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('没有本地记录', () => {
    it('宽屏默认展开', () => {
      const { shouldAutoOpen } = useSidePanelPreference()
      expect(shouldAutoOpen(WIDE, PANEL_W)).toBe(true)
    })

    it('窄屏不展开，也不写记录', () => {
      const { shouldAutoOpen } = useSidePanelPreference()
      expect(shouldAutoOpen(NARROW, PANEL_W)).toBe(false)
      expect(localStorage.getItem(SIDE_PANEL_AUTO_OPEN_KEY)).toBeNull()
    })

    it('阈值跟着面板宽度走', () => {
      const { shouldAutoOpen } = useSidePanelPreference()
      expect(shouldAutoOpen(WIDE, PANEL_W + 100)).toBe(false)
      expect(shouldAutoOpen(WIDE + 100, PANEL_W + 100)).toBe(true)
    })
  })

  describe('有本地记录', () => {
    it('closed：宽屏也不展开', () => {
      localStorage.setItem(SIDE_PANEL_AUTO_OPEN_KEY, 'closed')
      const { shouldAutoOpen } = useSidePanelPreference()
      expect(shouldAutoOpen(WIDE + 1000, PANEL_W)).toBe(false)
    })

    it('open：窄屏也展开（用户明确要过）', () => {
      localStorage.setItem(SIDE_PANEL_AUTO_OPEN_KEY, 'open')
      const { shouldAutoOpen } = useSidePanelPreference()
      expect(shouldAutoOpen(NARROW, PANEL_W)).toBe(true)
    })
  })

  describe('写入', () => {
    it('markClosed 写 closed，markOpened 写回 open，最后一次操作说了算', () => {
      const { markClosed, markOpened, shouldAutoOpen } = useSidePanelPreference()
      markClosed()
      expect(localStorage.getItem(SIDE_PANEL_AUTO_OPEN_KEY)).toBe('closed')
      expect(shouldAutoOpen(WIDE, PANEL_W)).toBe(false)
      markOpened()
      expect(localStorage.getItem(SIDE_PANEL_AUTO_OPEN_KEY)).toBe('open')
      expect(shouldAutoOpen(NARROW, PANEL_W)).toBe(true)
    })
  })
})
