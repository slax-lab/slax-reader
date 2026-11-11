import { flushPromises } from '@vue/test-utils'
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

const { mockShowToast } = vi.hoisted(() => ({ mockShowToast: vi.fn() }))
vi.mock('~/components/Toast', () => ({ default: { showToast: mockShowToast }, ToastType: { Error: 'error' } }))

vi.mock('~/utils/modal', () => ({
  modalBootloader: modalBootloaderMock
}))

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
  mockShowToast.mockClear()
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
  it.each([
    ['feedback', () => showFeedbackModal({ title: 'fixture', reportType: 'bug', email: 'fixture@example.invalid' })],
    ['edit name', () => showEditNameModal({ bookmarkId: 1, name: 'fixture' })],
    ['edit tag', () => showEditTagModal({ tagId: 1, tagName: 'fixture' })],
    ['login', () => showLoginModal({})],
    ['share', () => showShareConfigModal({ bookmarkId: 1, title: 'fixture' })],
    ['status', () => showSnapshotStatusModal({ status: BookmarkParseStatus.SUCCESS, title: 'fixture', content: 'fixture' })]
  ] as const)('does not label %s mounting errors as import failures', async (_name, open) => {
    const error = new Error('component setup failed')
    modalBootloaderMock.mockImplementationOnce(() => { throw error })
    await expect(open()).rejects.toBe(error)
    expect(mockShowToast).not.toHaveBeenCalled()
  })

  describe('showFeedbackModal', () => {
    it('用 Feedback 组件 + 透传 reportType/title/href/email/params；params 缺失时 fallback {}', async () => {
      showFeedbackModal({
        title: 'T',
        reportType: 'bug',
        href: 'https://x.com',
        email: 'a@b.com'
      })
      await flushPromises()

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
      await flushPromises()
      const call2 = requireLastCall()
      expect(call2.props.params).toEqual({ id: 1, kind: 'x' })
    })

    it('onDismiss 调 app.unmount + 容器 remove', async () => {
      showFeedbackModal({ title: 'T', reportType: 'bug', email: 'a@b.com' })
      await flushPromises()
      const call = requireLastCall()
      const app = requireLastApp()

      const onDismiss = call.props.onDismiss as () => void
      onDismiss()

      expect(app.unmount).toHaveBeenCalledTimes(1)
      expect(app._container.remove).toHaveBeenCalledTimes(1)
    })
  })

  describe('showEditNameModal', () => {
    it('用 EditName 组件 + 透传 name/bookmarkId；aliasName 缺失时 fallback ""', async () => {
      showEditNameModal({ bookmarkId: 1, name: 'foo' })
      await flushPromises()
      const call = requireLastCall()
      expect(call.ele).toBe(EditName)
      expect(call.props.name).toBe('foo')
      expect(call.props.bookmarkId).toBe(1)
      expect(call.props.aliasName).toBe('')

      showEditNameModal({ bookmarkId: 2, name: 'foo', aliasName: 'bar' })
      await flushPromises()
      expect(requireLastCall().props.aliasName).toBe('bar')
    })

    it('onSuccess(name) 透传给 options.callback；onDismiss 调 unmount + remove', async () => {
      const callback = vi.fn()
      showEditNameModal({ bookmarkId: 1, name: 'foo', callback })
      await flushPromises()

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
      await flushPromises()
      const onSuccess2 = requireLastCall().props.onSuccess as (n: string) => void
      expect(() => onSuccess2('x')).not.toThrow()
    })
  })

  describe('showEditTagModal', () => {
    it('用 EditTag 组件 + 透传 tagId/tagName；tagName 为空字符串时仍透传 ""（源码 `tagName || ""` fallback）', async () => {
      showEditTagModal({ tagId: 7, tagName: 'work' })
      await flushPromises()
      const call = requireLastCall()
      expect(call.ele).toBe(EditTag)
      expect(call.props.tagId).toBe(7)
      expect(call.props.tagName).toBe('work')

      // tagName 为空字符串：源码 `tagName || ''` fallback → 仍是 ''
      showEditTagModal({ tagId: 8, tagName: '' })
      await flushPromises()
      expect(requireLastCall().props.tagName).toBe('')
    })

    it('onSuccess + onDelete 分别透传给 callback / deleteCallback；onDismiss 调 unmount + remove', async () => {
      const callback = vi.fn()
      const deleteCallback = vi.fn()
      showEditTagModal({ tagId: 7, tagName: 'work', callback, deleteCallback })
      await flushPromises()

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
      await flushPromises()
      const call2 = requireLastCall()
      const onSuccess2 = call2.props.onSuccess as (id: number, name: string) => void
      const onDelete2 = call2.props.onDelete as (id: number) => void
      expect(() => onSuccess2(1, 'x')).not.toThrow()
      expect(() => onDelete2(1)).not.toThrow()
    })
  })

  describe('showLoginModal', () => {
    it('用 LoginModal 组件 + 透传 redirect', async () => {
      showLoginModal({ redirect: '/back' })
      await flushPromises()
      const call = requireLastCall()
      expect(call.ele).toBe(LoginModal)
      expect(call.props.redirect).toBe('/back')

      showLoginModal({})
      await flushPromises()
      expect(requireLastCall().props.redirect).toBeUndefined()
    })

    it('onDismiss 调 unmount + remove', async () => {
      showLoginModal({ redirect: '/back' })
      await flushPromises()
      const call = requireLastCall()
      const app = requireLastApp()

      const onDismiss = call.props.onDismiss as () => void
      onDismiss()
      expect(app.unmount).toHaveBeenCalledTimes(1)
      expect(app._container.remove).toHaveBeenCalledTimes(1)
    })
  })

  describe('showShareConfigModal', () => {
    it('用 ShareModal 组件 + 透传 bookmarkId/title；type 缺失时 fallback ShareModalType.Bookmark', async () => {
      showShareConfigModal({ bookmarkId: 42, title: 'hello' })
      await flushPromises()
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
      await flushPromises()
      expect(requireLastCall().props.type).toBe('original')
    })

    it('onDismiss 调 unmount + remove', async () => {
      showShareConfigModal({ bookmarkId: 42, title: 'hello' })
      await flushPromises()
      const call = requireLastCall()
      const app = requireLastApp()

      const onDismiss = call.props.onDismiss as () => void
      onDismiss()
      expect(app.unmount).toHaveBeenCalledTimes(1)
      expect(app._container.remove).toHaveBeenCalledTimes(1)
    })
  })

  describe('showSnapshotStatusModal', () => {
    it('用 SnapshotStatusModal 组件 + 透传 status/title/content', async () => {
      showSnapshotStatusModal({
        status: BookmarkParseStatus.SUCCESS,
        title: 'snap',
        content: 'detail'
      })
      await flushPromises()
      const call = requireLastCall()
      expect(call.ele).toBe(SnapshotStatusModal)
      expect(call.props.status).toBe(BookmarkParseStatus.SUCCESS)
      expect(call.props.title).toBe('snap')
      expect(call.props.content).toBe('detail')
    })

    it('onConfirm(dontRemindAgain) 透传给 options.onConfirm 后 unmount + remove；onDismiss 仅 unmount + remove', async () => {
      const onConfirm = vi.fn()
      showSnapshotStatusModal({
        status: BookmarkParseStatus.SUCCESS,
        title: 'snap',
        content: 'detail',
        onConfirm
      })
      await flushPromises()
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
      await flushPromises()
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
