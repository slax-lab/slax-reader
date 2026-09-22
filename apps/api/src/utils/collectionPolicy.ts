export interface CollectionPolicySource {
  is_enable: boolean
  show_line: boolean
  show_comment: boolean
  allow_line: boolean
  allow_comment: boolean
  show_userinfo: boolean
}

export interface CollectionPolicy {
  showMarks: boolean
  allowMarks: boolean
  allowLine: boolean
  allowComment: boolean
  showProfile: boolean
}

export function resolveCollectionPolicy(share: CollectionPolicySource | null | undefined): CollectionPolicy {
  if (!share) return { showMarks: true, allowMarks: false, allowLine: false, allowComment: false, showProfile: true }

  const allowLine = share.is_enable && share.allow_line
  const allowComment = share.is_enable && share.allow_comment

  return {
    showMarks: share.is_enable && share.show_line && share.show_comment,
    allowMarks: allowLine && allowComment,
    allowLine,
    allowComment,
    showProfile: share.is_enable && share.show_userinfo
  }
}
