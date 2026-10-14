import { mountWithApp } from '../../setup/mount'
import type { MarkCommentInfo, MarkItemInfo } from '@slax-reader/selection/types'
import { describe, expect, it } from 'vitest'

const comment = (overrides: Partial<MarkCommentInfo> = {}): MarkCommentInfo => ({
  markUid: 'root-uid',
  comment: 'root comment',
  userId: 10,
  username: 'Creator',
  avatar: '',
  isDeleted: false,
  createdAt: new Date('2026-09-14'),
  children: [],
  showInput: false,
  loading: false,
  operateLoading: false,
  ...overrides
})

const info = (comments: MarkCommentInfo[]): MarkItemInfo => ({
  id: 'info-1',
  source: [],
  stroke: [],
  comments
})

describe('Snapshot visitor reply permissions', () => {
  it('shows reply and own-reply delete without exposing root delete', async () => {
    const { default: SnapshotCommentCard } = await import('~/components/Snapshot/SnapshotCommentCard.vue')
    const ownReply = comment({ markUid: 'visitor-reply', comment: 'visitor reply', userId: 20, username: 'Visitor' })
    const wrapper = mountWithApp(SnapshotCommentCard, {
      props: {
        infoId: 'info-1',
        source: [],
        comments: [comment({ children: [ownReply] })],
        allowAction: false,
        allowReply: true,
        allowDeleteOwnReply: true,
        canDeleteComment: true,
        currentUserId: 20
      }
    })

    expect(wrapper.find('.comment-reply-trigger').exists()).toBe(true)
    expect(wrapper.find('.comment-sub-reply-btn').exists()).toBe(true)
    expect(wrapper.find('.comment-sub-delete-btn').exists()).toBe(true)
    expect(wrapper.find('.comment-delete-trigger').exists()).toBe(false)
  })

  it('does not expose any action for a pure highlight', async () => {
    const { default: SnapshotCommentCard } = await import('~/components/Snapshot/SnapshotCommentCard.vue')
    const wrapper = mountWithApp(SnapshotCommentCard, {
      props: {
        infoId: 'info-1',
        source: [{ type: 'text', path: '/p', start: 0, end: 4 }],
        comments: [],
        strokeUser: { username: 'Creator' },
        allowAction: false,
        allowReply: true,
        currentUserId: 20
      }
    })

    expect(wrapper.find('.comment-meta-actions').exists()).toBe(false)
  })

  it('does not expose reply or delete on a deleted child reply', async () => {
    const { default: SnapshotCommentCard } = await import('~/components/Snapshot/SnapshotCommentCard.vue')
    const deletedReply = comment({ markUid: 'deleted-reply', userId: 20, isDeleted: true })
    const wrapper = mountWithApp(SnapshotCommentCard, {
      props: {
        infoId: 'info-1',
        source: [],
        comments: [comment({ children: [deletedReply] })],
        allowAction: false,
        allowReply: true,
        allowDeleteOwnReply: true,
        currentUserId: 20
      }
    })

    expect(wrapper.find('.comment-sub-reply-btn').exists()).toBe(false)
    expect(wrapper.find('.comment-sub-delete-btn').exists()).toBe(false)
  })

  it('hides the reply-only composer unless the reply target exists', async () => {
    const { default: SnapshotCommentComposer } = await import('~/components/Snapshot/SnapshotCommentComposer.vue')
    const baseProps = {
      allowAction: false,
      allowReply: true,
      articleSelection: null,
      pendingSelection: null,
      pendingQuote: null,
      activeInfoId: 'info-1',
      infos: [info([comment()])],
      composeStroke: false
    }

    const valid = mountWithApp(SnapshotCommentComposer, { props: { ...baseProps, replyToUid: 'root-uid' } })
    expect(valid.find('.comment-composer').exists()).toBe(true)

    const missing = mountWithApp(SnapshotCommentComposer, { props: { ...baseProps, replyToUid: 'missing-uid' } })
    expect(missing.find('.comment-composer').exists()).toBe(false)

    const deleted = mountWithApp(SnapshotCommentComposer, {
      props: { ...baseProps, replyToUid: 'root-uid', infos: [info([comment({ isDeleted: true })])] }
    })
    expect(deleted.find('.comment-composer').exists()).toBe(false)

    const forgedRootComment = mountWithApp(SnapshotCommentComposer, {
      props: { ...baseProps, replyToUid: null, pendingSelection: info([]) }
    })
    expect(forgedRootComment.find('.comment-composer').exists()).toBe(false)
  })
})
