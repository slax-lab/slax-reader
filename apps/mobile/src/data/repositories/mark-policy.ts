import type {CollectionMarkPolicy, CollectionSettings} from './types.ts';

export const PERSONAL_MARK_POLICY: CollectionMarkPolicy = {
  isCollection: false,
  showMarks: true,
  allowLine: true,
  allowComment: true,
  showProfile: true,
};

export const PENDING_COLLECTION_MARK_POLICY: CollectionMarkPolicy = {
  isCollection: true,
  showMarks: false,
  allowLine: false,
  allowComment: false,
  showProfile: false,
};

export function collectionMarkPolicy(
  share: Readonly<Record<string, unknown>> | null,
  settings: Readonly<CollectionSettings> = {allow_highlight: false, show_highlight: true, allow_access: true},
): CollectionMarkPolicy {
  const enabled = Boolean(share?.is_enable ?? settings.allow_access);
  return {
    isCollection: true,
    showMarks: enabled && Boolean(share?.show_line ?? settings.show_highlight) && Boolean(share?.show_comment ?? settings.show_highlight),
    allowLine: enabled && Boolean(share?.allow_line ?? settings.allow_highlight),
    allowComment: enabled && Boolean(share?.allow_comment ?? settings.allow_highlight),
    showProfile: enabled && Boolean(share?.show_userinfo ?? true),
  };
}
