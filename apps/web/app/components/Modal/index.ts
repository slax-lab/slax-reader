import EditName from './EditName.vue'
import EditTag from './EditTag.vue'
import Feedback from './Feedback.vue'
import LoginModal from './LoginModal.vue'
import ShareModal, { ShareModalType } from './ShareModal.vue'
import SnapshotStatusModal from './SnapshotStatusModal.vue'

import { modalBootloader } from '~/utils/modal'

import { BookmarkParseStatus } from '@commons/types/interface'

export const showFeedbackModal = (options: { title: string; reportType: string; href?: string; email: string; params?: Record<string, string | number> }) => {
  const app = modalBootloader({
    ele: Feedback,
    props: {
      reportType: options.reportType,
      title: options.title,
      href: options.href,
      email: options.email,
      params: options.params ?? {},
      onDismiss: () => {
        app.unmount()
        app._container?.remove()
      }
    }
  })
}

export const showEditNameModal = (options: { bookmarkId: number; name: string; aliasName?: string; callback?: (name: string) => void }) => {
  const app = modalBootloader({
    ele: EditName,
    props: {
      name: options.name,
      aliasName: options.aliasName || '',
      bookmarkId: options.bookmarkId,
      onDismiss: () => {
        app.unmount()
        app._container?.remove()
      },
      onSuccess: (name: string) => {
        options.callback && options.callback(name)
      }
    }
  })
}

// tagId：REST 下是 hashid 字符串，local-first 下是 uuid（idKind = 'uuid'）
export const showEditTagModal = (options: {
  tagId: number | string
  tagName: string
  source?: 'auto' | 'mine'
  idKind?: 'hashid' | 'uuid'
  callback?: (id: number | string, name: string) => void
  deleteCallback?: (id: number | string) => void
  demoteCallback?: (id: number | string) => void
}) => {
  const app = modalBootloader({
    ele: EditTag,
    props: {
      tagId: options.tagId,
      tagName: options.tagName || '',
      source: options.source ?? 'auto',
      idKind: options.idKind ?? 'hashid',
      onDismiss: () => {
        app.unmount()
        app._container?.remove()
      },
      onSuccess: (id: number | string, name: string) => {
        options.callback && options.callback(id, name)
      },
      onDelete: (id: number | string) => {
        options.deleteCallback && options.deleteCallback(id)
      },
      onDemote: (id: number | string) => {
        options.demoteCallback && options.demoteCallback(id)
      }
    }
  })
}

export const showLoginModal = (options: { redirect?: string }) => {
  const app = modalBootloader({
    ele: LoginModal,
    props: {
      redirect: options.redirect,
      onDismiss: () => {
        app.unmount()
        app._container?.remove()
      }
    }
  })
}

export const showShareConfigModal = (options: { bookmarkId: number; title: string; type?: ShareModalType }) => {
  const app = modalBootloader({
    ele: ShareModal,
    props: {
      bookmarkId: options.bookmarkId,
      title: options.title,
      type: options.type || ShareModalType.Bookmark,
      onDismiss: () => {
        app.unmount()
        app._container?.remove()
      }
    }
  })
}

export const showSnapshotStatusModal = (options: { status: BookmarkParseStatus; title: string; content: string; onConfirm?: (dontRemindAgain: boolean) => void }) => {
  const app = modalBootloader({
    ele: SnapshotStatusModal,
    props: {
      status: options.status,
      title: options.title,
      content: options.content,
      onDismiss: () => {
        app.unmount()
        app._container?.remove()
      },
      onConfirm: (dontRemindAgain: boolean) => {
        options.onConfirm && options.onConfirm(dontRemindAgain)
        app.unmount()
        app._container?.remove()
      }
    }
  })
}
