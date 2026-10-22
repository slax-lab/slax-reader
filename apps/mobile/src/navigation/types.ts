import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParams = {
  Login: undefined;
  Library: {source?: {kind: 'collection' | 'rss'; id: string}} | undefined;
  Search: undefined;
  Reader: { bookmarkId: string; collectionOwnerId?: string; collectionId?: string; title?: string; rssEntryId?: string; openedFrom?: string };
  Settings: undefined;
  About: undefined;
  Debug: undefined;
  DeleteAccount: undefined;
  Subscription: undefined;
  Feedback: { bookmarkId?: string; targetUrl?: string; entryPoint?: string; type?: string; title?: string } | undefined;
};
export type MobileScreenProps<T extends keyof RootStackParams> = NativeStackScreenProps<RootStackParams, T>;
