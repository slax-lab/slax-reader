// components/Modal/index.ts 测试套件 —— Sprint 4
// 覆盖 6 个 showXxxModal helper（12 用例）：每个 helper 测「props 透传」+「回调路径」
//
// 关键策略：
//   1. mock ~/utils/modal 的 modalBootloader：捕获 options 到 lastCall.value
//      并返回受控 app stub（含 unmount 与 _container.remove）
//   2. mock 6 个 .vue 组件文件用 ~~/layers/... alias，避免在 happy-dom 下真渲染 SFC
//   3. ShareModalType mock 必须用真实枚举值 { Bookmark: 'bookmark', Original: 'original' }
//      （ShareModal.vue:49-52）
//   4. lastCall 用强类型 ModalBootloaderArgs，避免 as any
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ModalBootloaderArgs = {
  ele: unknown
  props: Record<string, unknown>
  container?: { styles: Record<string, unknown> }
}

type AppStub = {
  unmount: ReturnType<typeof vi.fn>
  _container: { remove: ReturnType<typeof vi.fn> }
}

const { lastCall, lastApp, modalBootloaderMock } = vi.hoisted(() => {
  const lastCall: { value: ModalBootloaderArgs | null } = { value: null }
  const lastApp: { value: AppStub | null } = { value: null }
  const modalBootloaderMock = vi.fn((options: ModalBootloaderArgs) => {
    lastCall.value = options
    const app: AppStub = {
      unmount: vi.fn(),
      _container: { remove: vi.fn() }
    }
    lastApp.value = app
    return app
  })
  return { lastCall, lastApp, modalBootloaderMock }
})

vi.mock('~/utils/modal', () => ({
  modalBootloader: modalBootloaderMock
}))

// 6 个组件 stub —— 用 ~~/layers/... 命中 components/Modal/index.ts 静态相对 import 解析后的绝对路径
vi.mock('~~/app/components/Modal/Feedback.vue', () => ({
  default: { name: 'FeedbackStub' }
}))
vi.mock('~~/app/components/Modal/EditName.vue', () => ({
  default: { name: 'EditNameStub' }
}))
vi.mock('~~/app/components/Modal/EditTag.vue', () => ({
  default: { name: 'EditTagStub' }
}))
vi.mock('~~/app/components/Modal/LoginModal.vue', () => ({
  default: { name: 'LoginModalStub' }
}))
vi.mock('~~/app/components/Modal/ShareModal.vue', () => ({
  default: { name: 'ShareModalStub' },
  // 真实枚举值（参见 ShareModal.vue:49-52）：
  // export enum ShareModalType { Bookmark = 'bookmark', Original = 'original' }
  ShareModalType: { Bookmark: 'bookmark', Original: 'original' }
}))
vi.mock('~~/app/components/Modal/SnapshotStatusModal.vue', () => ({
  default: { name: 'SnapshotStatusModalStub' }
}))

import EditName from '~~/app/components/Modal/EditName.vue'
import EditTag from '~~/app/components/Modal/EditTag.vue'
import Feedback from '~~/app/components/Modal/Feedback.vue'
import LoginModal from '~~/app/components/Modal/LoginModal.vue'
import ShareModal from '~~/app/components/Modal/ShareModal.vue'
import SnapshotStatusModal from '~~/app/components/Modal/SnapshotStatusModal.vue'

import { BookmarkParseStatus } from '@slax-reader/contracts/interface'
import { showEditNameModal, showEditTagModal, showFeedbackModal, showLoginModal, showShareConfigModal, showSnapshotStatusModal } from '~~/app/components/Modal'

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  modalBootloaderMock.mockClear()
  lastCall.value = null
  lastApp.value = null
})

const requireLastCall = (): ModalBootloaderArgs => {
  if (!lastCall.value) throw new Error('modalBootloader not called')
  return lastCall.value
}

const requireLastApp = (): AppStub => {
  if (!lastApp.value) throw new Error('app stub not captured')
  return lastApp.value
}

describe('Modal helpers', () => {
  describe('showFeedbackModal', () => {
    it('用 Feedback 组件 + 透传 reportType/title/href/email/params；params 缺失时 fallback {}', () => {
      showFeedbackModal({
        title: 'T',
        reportType: 'bug',
        href: 'https://x.com',
        email: 'a@b.com'
      })

      const call = requireLastCall()
      expect(call.ele).toBe(Feedback)
      expect(call.props.reportType).toBe('bug')
      expect(call.props.title).toBe('T')
      expect(call.props.href).toBe('https://x.com')
      expect(call.props.email).toBe('a@b.com')
      expect(call.props.params).toEqual({})

      // 显式传 params 时透传
      showFeedbackModal({
        title: 'T2',
        reportType: 'spam',
        email: 'a@b.com',
        params: { id: 1, kind: 'x' }
      })
      const call2 = requireLastCall()
      expect(call2.props.params).toEqual({ id: 1, kind: 'x' })
    })

    it('onDismiss 调 app.unmount + 容器 remove', () => {
      showFeedbackModal({ title: 'T', reportType: 'bug', email: 'a@b.com' })
      const call = requireLastCall()
      const app = requireLastApp()

      const onDismiss = call.props.onDismiss as () => void
      onDismiss()

      expect(app.unmount).toHaveBeenCalledTimes(1)
      expect(app._container.remove).toHaveBeenCalledTimes(1)
    })
  })

  describe('showEditNameModal', () => {
    it('用 EditName 组件 + 透传 name/bookmarkId；aliasName 缺失时 fallback ""', () => {
      showEditNameModal({ bookmarkId: 1, name: 'foo' })
      const call = requireLastCall()
      expect(call.ele).toBe(EditName)
      expect(call.props.name).toBe('foo')
      expect(call.props.bookmarkId).toBe(1)
      expect(call.props.aliasName).toBe('')

      showEditNameModal({ bookmarkId: 2, name: 'foo', aliasName: 'bar' })
      expect(requireLastCall().props.aliasName).toBe('bar')
    })

    it('onSuccess(name) 透传给 options.callback；onDismiss 调 unmount + remove', () => {
      const callback = vi.fn()
      showEditNameModal({ bookmarkId: 1, name: 'foo', callback })

      const call = requireLastCall()
      const app = requireLastApp()

      const onSuccess = call.props.onSuccess as (n: string) => void
      onSuccess('newName')
      expect(callback).toHaveBeenCalledWith('newName')

      const onDismiss = call.props.onDismiss as () => void
      onDismiss()
      expect(app.unmount).toHaveBeenCalledTimes(1)
      expect(app._container.remove).toHaveBeenCalledTimes(1)

      // callback 缺失时 onSuccess 不抛
      showEditNameModal({ bookmarkId: 1, name: 'foo' })
      const onSuccess2 = requireLastCall().props.onSuccess as (n: string) => void
      expect(() => onSuccess2('x')).not.toThrow()
    })
  })

  describe('showEditTagModal', () => {
    it('用 EditTag 组件 + 透传 tagId/tagName；tagName 为空字符串时仍透传 ""（源码 `tagName || ""` fallback）', () => {
      showEditTagModal({ tagId: 7, tagName: 'work' })
      const call = requireLastCall()
      expect(call.ele).toBe(EditTag)
      expect(call.props.tagId).toBe(7)
      expect(call.props.tagName).toBe('work')

      // tagName 为空字符串：源码 `tagName || ''` fallback → 仍是 ''
      showEditTagModal({ tagId: 8, tagName: '' })
      expect(requireLastCall().props.tagName).toBe('')
    })

    it('onSuccess + onDelete 分别透传给 callback / deleteCallback；onDismiss 调 unmount + remove', () => {
      const callback = vi.fn()
      const deleteCallback = vi.fn()
      showEditTagModal({ tagId: 7, tagName: 'work', callback, deleteCallback })

      const call = requireLastCall()
      const app = requireLastApp()
      const onSuccess = call.props.onSuccess as (id: number, name: string) => void
      onSuccess(7, 'work2')
      expect(callback).toHaveBeenCalledWith(7, 'work2')

      const onDelete = call.props.onDelete as (id: number) => void
      onDelete(7)
      expect(deleteCallback).toHaveBeenCalledWith(7)

      const onDismiss = call.props.onDismiss as () => void
      onDismiss()
      expect(app.unmount).toHaveBeenCalledTimes(1)
      expect(app._container.remove).toHaveBeenCalledTimes(1)

      // 缺失 callback / deleteCallback 时不抛
      showEditTagModal({ tagId: 7, tagName: 'work' })
      const call2 = requireLastCall()
      const onSuccess2 = call2.props.onSuccess as (id: number, name: string) => void
      const onDelete2 = call2.props.onDelete as (id: number) => void
      expect(() => onSuccess2(1, 'x')).not.toThrow()
      expect(() => onDelete2(1)).not.toThrow()
    })
  })

  describe('showLoginModal', () => {
    it('用 LoginModal 组件 + 透传 redirect', () => {
      showLoginModal({ redirect: '/back' })
      const call = requireLastCall()
      expect(call.ele).toBe(LoginModal)
      expect(call.props.redirect).toBe('/back')

      showLoginModal({})
      expect(requireLastCall().props.redirect).toBeUndefined()
    })

    it('onDismiss 调 unmount + remove', () => {
      showLoginModal({ redirect: '/back' })
      const call = requireLastCall()
      const app = requireLastApp()

      const onDismiss = call.props.onDismiss as () => void
      onDismiss()
      expect(app.unmount).toHaveBeenCalledTimes(1)
      expect(app._container.remove).toHaveBeenCalledTimes(1)
    })
  })

  describe('showShareConfigModal', () => {
    it('用 ShareModal 组件 + 透传 bookmarkId/title；type 缺失时 fallback ShareModalType.Bookmark', () => {
      showShareConfigModal({ bookmarkId: 42, title: 'hello' })
      const call = requireLastCall()
      expect(call.ele).toBe(ShareModal)
      expect(call.props.bookmarkId).toBe(42)
      expect(call.props.title).toBe('hello')
      expect(call.props.type).toBe('bookmark')

      // 显式传 Original 时透传
      // 直接用真实枚举值字符串避免再 import 一次
      showShareConfigModal({
        bookmarkId: 42,
        title: 'hello',
        type: 'original' as unknown as Parameters<typeof showShareConfigModal>[0]['type']
      })
      expect(requireLastCall().props.type).toBe('original')
    })

    it('onDismiss 调 unmount + remove', () => {
      showShareConfigModal({ bookmarkId: 42, title: 'hello' })
      const call = requireLastCall()
      const app = requireLastApp()

      const onDismiss = call.props.onDismiss as () => void
      onDismiss()
      expect(app.unmount).toHaveBeenCalledTimes(1)
      expect(app._container.remove).toHaveBeenCalledTimes(1)
    })
  })

  describe('showSnapshotStatusModal', () => {
    it('用 SnapshotStatusModal 组件 + 透传 status/title/content', () => {
      showSnapshotStatusModal({
        status: BookmarkParseStatus.SUCCESS,
        title: 'snap',
        content: 'detail'
      })
      const call = requireLastCall()
      expect(call.ele).toBe(SnapshotStatusModal)
      expect(call.props.status).toBe(BookmarkParseStatus.SUCCESS)
      expect(call.props.title).toBe('snap')
      expect(call.props.content).toBe('detail')
    })

    it('onConfirm(dontRemindAgain) 透传给 options.onConfirm 后 unmount + remove；onDismiss 仅 unmount + remove', () => {
      const onConfirm = vi.fn()
      showSnapshotStatusModal({
        status: BookmarkParseStatus.SUCCESS,
        title: 'snap',
        content: 'detail',
        onConfirm
      })
      const call = requireLastCall()
      const app = requireLastApp()

      const handler = call.props.onConfirm as (dontRemindAgain: boolean) => void
      handler(true)
      expect(onConfirm).toHaveBeenCalledWith(true)
      expect(app.unmount).toHaveBeenCalledTimes(1)
      expect(app._container.remove).toHaveBeenCalledTimes(1)

      // onDismiss 路径：仅 unmount + remove
      showSnapshotStatusModal({
        status: BookmarkParseStatus.SUCCESS,
        title: 'snap',
        content: 'detail'
      })
      const call2 = requireLastCall()
      const app2 = requireLastApp()
      const onDismiss = call2.props.onDismiss as () => void
      onDismiss()
      expect(app2.unmount).toHaveBeenCalledTimes(1)
      expect(app2._container.remove).toHaveBeenCalledTimes(1)

      // onConfirm 缺失时仍可触发，不抛
      const handler2 = call2.props.onConfirm as (dontRemindAgain: boolean) => void
      expect(() => handler2(false)).not.toThrow()
      // 第二次 unmount + remove（onConfirm 内部也调 unmount/remove）
      expect(app2.unmount).toHaveBeenCalledTimes(2)
      expect(app2._container.remove).toHaveBeenCalledTimes(2)
    })
  })
})
