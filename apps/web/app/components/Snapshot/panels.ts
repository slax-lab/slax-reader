import type { IconKey } from '~/icons/registry'

// 侧栏面板单一来源：edge toolbar 与 side panel tab 共用；页面用 panels prop 裁剪子集（如非 owner 隐藏 Chat），不传则全部

export type SnapshotPanelId = 'ai' | 'transcript' | 'chat' | 'comment'

export interface SnapshotPanelDef {
  id: SnapshotPanelId
  label: string
  icon: IconKey
}

interface SnapshotPanelSource {
  id: SnapshotPanelId
  labelKey: string
  icon: IconKey
}

// 顺序即展示顺序
const SNAPSHOT_PANEL_SOURCES: SnapshotPanelSource[] = [
  {
    id: 'ai',
    labelKey: 'page.bookmarks_detail.ai_analyze',
    icon: 'snapshot.ai'
  },
  {
    // 仅 YouTube 书签可见，页面通过 panels 子集裁剪
    id: 'transcript',
    labelKey: 'component.transcript_panel.title',
    icon: 'snapshot.transcript'
  },
  {
    id: 'chat',
    labelKey: 'page.bookmarks_detail.chat',
    icon: 'snapshot.chat'
  },
  {
    id: 'comment',
    labelKey: 'common.operate.comment',
    icon: 'snapshot.comment'
  }
]

// t 由调用方传入，保证响应式更新
export function resolveSnapshotPanels(ids: SnapshotPanelId[] | undefined, t: (key: string) => string): SnapshotPanelDef[] {
  const allow = ids ? new Set(ids) : null
  const sources = allow ? SNAPSHOT_PANEL_SOURCES.filter(panel => allow.has(panel.id)) : SNAPSHOT_PANEL_SOURCES
  return sources.map(({ id, labelKey, icon }) => ({ id, label: t(labelKey), icon }))
}
