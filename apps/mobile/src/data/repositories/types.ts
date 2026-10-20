import type {MarkPathItem, MarkPathApprox} from '@slax-reader/contracts/interface';

export interface BookmarkRecord {
  id: string;
  userId: string;
  ownerId?: string;
  aliasTitle: string;
  title: string;
  url: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  archiveStatus: number;
  isStarred: number;
  isRead: number;
  metadata: string | null;
  downloadStatus: number;
  isAutoCached: boolean;
  contentType?: 'article' | 'shortcut' | 'pdf';
}

/** Minimal local projection used by opted-in OS search; article bodies and notes are never read. */
export interface SystemCatalogBookmark {
  id: string; title: string; aliasTitle: string; url: string; status: string; createdAt: string; archiveStatus: number;
}


export interface TagRecord {
  id: string;
  tag_name: string;
  display: string;
  source: string;
  created_at: string;
  last_used_at?: string | null;
}

export interface CollectionRecord {
  id: string;
  code: string;
  name: string;
  avatar: string;
  description: string;
  ownerId: string;
  type: number;
  status: number;
  subscriptionEndTime: string;
  subscribedAt: string;
  isCancelled: boolean;
  lastReadAt: string;
  latestArticleAt: string;
  hasNew: boolean;
}

export interface MarkRecord {
  id: string;
  user_bookmark_uuid: string;
  type: number;
  source: string;
  comment: string;
  approx_source: string;
  content: string;
  is_deleted: number;
  created_at: string;
  metadata: string;
}

export interface CollectionMarkPolicy {
  isCollection: boolean;
  showMarks: boolean;
  allowLine: boolean;
  allowComment: boolean;
  showProfile: boolean;
}

export interface CollectionSettings {
  allow_highlight: boolean;
  show_highlight: boolean;
  allow_access: boolean;
}

export interface SelectionContent {
  type: string;
  text: string;
  src: string;
}

export interface CreateMarkInput {
  bookmarkId: string;
  userId: string;
  type: number;
  source?: MarkPathItem[];
  approxSource?: MarkPathApprox | null;
  selectContent?: SelectionContent[];
  comment?: string;
  rootId?: string | null;
  parentId?: string | null;
  markPolicy: CollectionMarkPolicy;
}

export interface BookmarkChanges {
  aliasTitle?: string;
  isStarred?: number;
  archiveStatus?: number;
  isRead?: number;
}

export interface CommentWatchOptions {
  collectionOwnerId?: string;
  enabled?: boolean;
}
