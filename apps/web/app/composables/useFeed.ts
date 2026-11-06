import { computed, onScopeDispose, type Ref, ref, watch } from "vue";

import { compareFeedEntries, feedRowKind } from "~/utils/feed";

import type {
  FeedEntriesResponse,
  FeedEntry,
  FeedEntryDetail,
  FeedKind,
  FeedSubscription,
  FeedSubscriptionsResponse,
  RssRefreshResponse,
  RssSaveResponse,
  RssSubscription,
} from "@slax-reader/contracts";
import {
  useLocalNewsletterPresence,
  useNewsletterLocalState,
} from "~/composables/newsletter/useNewsletterLocalState";
import { useRssEnabled } from "~/composables/rss/useRssEnabled";
import {
  rssLocalDatabase,
  rssLocalOwned,
  useRssLocalState,
} from "~/composables/rss/useRssLocalState";
import { useLabFeatures } from "~/composables/useLabFeatures";
import { useUserStore } from "~/stores/user";

type CachedList = {
  items: FeedEntry[];
  cursor: string | null;
  pages: number;
  updatedAt: number;
  hasMore: boolean;
  historyStatus: FeedEntriesResponse["history_status"];
  retryAt: string | null;
};
const CACHE_TTL = 60_000;
export const feedSubscriptionName = (row: {
  title: string;
  remark?: string | null;
}) => row.remark?.trim() || row.title;
export const feedSourceText = (name: string) =>
  name
    .normalize("NFKC")
    .match(
      /\p{Script=Han}|(?:(?!\p{Script=Han})\p{L})(?:(?!\p{Script=Han})[\p{L}\p{M}])*/u
    )?.[0] || "RSS";

/** Mixed and Newsletter lists use owned local streams; clients without local storage retain REST. */
export function useFeed() {
  const labs = useLabFeatures(),
    user = useUserStore();
  const restSubscriptions = ref<FeedSubscription[]>([]),
    restEntries = ref<FeedEntry[]>([]);
  const detail = ref<FeedEntryDetail | null>(null),
    selected = ref(""),
    restCursor = ref<string | null>(null);
  const restHasMore = ref(false),
    restHistoryStatus = ref<FeedEntriesResponse["history_status"]>("exhausted"),
    restRetryAt = ref<string | null>(null);
  const restoreList = (snapshot?: CachedList) => {
    restEntries.value = snapshot?.items || [];
    restCursor.value = snapshot?.cursor || null;
    restHasMore.value = snapshot?.hasMore || false;
    restHistoryStatus.value = snapshot?.historyStatus || "exhausted";
    restRetryAt.value = snapshot?.retryAt || null;
  };
  const loading = ref(false),
    initializing = ref(false),
    detailLoading = ref(false),
    pending = ref(false),
    savingEntryId = ref<string | null>(null),
    error = ref("");
  const cache = new Map<string, CachedList>();
  let permissionGeneration = 0,
    generation = 0,
    detailGeneration = 0,
    initializeGeneration = 0,
    session = 0;
  const database = rssLocalDatabase();
  const owned = database ? rssLocalOwned() : null;
  const newsletterPresent = database
    ? useLocalNewsletterPresence(
        database,
        owned!,
        computed(() => user.userInfo?.userId)
      )
    : null;
  const rssEnabled = database
    ? useRssEnabled(labs)
    : computed(() => labs.loaded.value && labs.isEnabled("rss"));
  const newsletterEnabled = computed(() =>
    labs.loaded.value
      ? labs.isEnabled("newsletter")
      : !!newsletterPresent?.value
  );
  const kinds = computed<FeedKind[]>(() => [
    ...(rssEnabled.value ? ["rss" as const] : []),
    ...(newsletterEnabled.value ? ["newsletter" as const] : []),
  ]);
  const enabled = newsletterEnabled;
  const allowed = (row: { kind?: string | null }) =>
    kinds.value.includes(feedRowKind(row));
  const localMode = computed(
    () =>
      enabled.value && !!database && !!owned?.value && !!user.userInfo?.userId
  );
  const localRss = database
    ? useRssLocalState(
        database,
        computed(() => localMode.value && rssEnabled.value),
        computed(() => user.userInfo?.userId),
        computed(() =>
          selected.value.startsWith("newsletter:") ? "" : selected.value
        )
      )
    : null;
  const localNewsletter = database
    ? useNewsletterLocalState(
        database,
        localMode,
        computed(() => user.userInfo?.userId),
        selected
      )
    : null;
  const showsRss = computed(
    () => rssEnabled.value && !selected.value.startsWith("newsletter:")
  );
  const showsNewsletter = computed(
    () => !selected.value || selected.value.startsWith("newsletter:")
  );
  const localSubscriptions = computed<FeedSubscription[]>(() => [
    ...(rssEnabled.value
      ? localRss!.subscriptions.value.map((row) => ({
          ...row,
          kind: "rss" as const,
        }))
      : []),
    ...localNewsletter!.subscriptions.value,
  ]);
  const localEntries = computed<FeedEntry[]>(() =>
    [
      ...(showsRss.value
        ? localRss!.entries.value.map((row) => ({
            ...row,
            kind: "rss" as const,
          }))
        : []),
      ...(showsNewsletter.value ? localNewsletter!.entries.value : []),
    ].sort(compareFeedEntries)
  );
  // Stream errors stay visible without replacing healthy RSS or cached Newsletter rows with mixed REST reads.
  const localUnavailable = computed(
    () =>
      localMode.value &&
      ((showsRss.value && localRss!.unavailable.value) ||
        (showsNewsletter.value && localNewsletter!.unavailable.value))
  );
  const localPending = computed(
    () =>
      localMode.value &&
      localEntries.value.length === 0 &&
      !localUnavailable.value &&
      ((showsRss.value && !localRss!.ready.value) ||
        (showsNewsletter.value && !localNewsletter!.ready.value))
  );
  const view = <T>(rest: Ref<T>, synced: () => T) =>
    computed<T>({
      get: () => (localMode.value ? synced() : rest.value),
      set: (value) => {
        rest.value = value;
      },
    });
  const subscriptions = view(restSubscriptions, () => localSubscriptions.value),
    entries = view(restEntries, () => localEntries.value),
    cursor = view(restCursor, () =>
      showsRss.value ? localRss!.cursor.value : null
    ),
    hasMore = view(
      restHasMore,
      () =>
        (showsRss.value && localRss!.hasMore.value) ||
        (showsNewsletter.value && localNewsletter!.hasMore.value)
    ),
    historyStatus = view(restHistoryStatus, () =>
      showsRss.value ? localRss!.historyStatus.value : "exhausted"
    ),
    retryAt = view(restRetryAt, () =>
      showsRss.value ? localRss!.retryAt.value : null
    );
  const fail = (e: unknown) => {
    error.value = e instanceof Error ? e.message : "source_unavailable";
  };
  const reportLocalError = () => {
    if (localUnavailable.value) error.value = "source_unavailable";
  };
  watch(localUnavailable, reportLocalError, { immediate: true, flush: "sync" });
  const clear = () => {
    session++;
    generation++;
    detailGeneration++;
    initializeGeneration++;
    cache.clear();
    restSubscriptions.value = [];
    restoreList();
    detail.value = null;
    selected.value = "";
    restCursor.value = null;
    loading.value = false;
    initializing.value = false;
    detailLoading.value = false;
    pending.value = false;
    savingEntryId.value = null;
    error.value = "";
  };
  watch(
    () => user.userInfo?.userId,
    (id) => {
      clear();
      if (id) void initialize();
    },
    { flush: "sync" }
  );
  watch(
    enabled,
    (value) => {
      if (!value) clear();
    },
    { flush: "sync" }
  );
  watch(
    kinds,
    () => {
      permissionGeneration++;
      pending.value = false;
      savingEntryId.value = null;
      generation++;
      detailGeneration++;
      detailLoading.value = false;
      loading.value = false;
      restSubscriptions.value = restSubscriptions.value.filter(allowed);
      restEntries.value = restEntries.value.filter(allowed);
      restCursor.value = null;
      for (const [key, snapshot] of cache) {
        snapshot.items = snapshot.items.filter(allowed);
        snapshot.updatedAt = 0;
        snapshot.cursor = null;
        if (key && !subscriptions.value.some((row) => row.id === key))
          cache.delete(key);
      }
      if (detail.value && !allowed(detail.value)) detail.value = null;
      if (
        selected.value &&
        !subscriptions.value.some((row) => row.id === selected.value)
      ) {
        selected.value = "";
        restoreList(cache.get(""));
      }
    },
    { flush: "sync" }
  );
  watch(
    localMode,
    (value) => {
      clear();
      if (!value && enabled.value && user.userInfo?.userId) void initialize();
    },
    { flush: "sync" }
  );
  watch(
    () => (localMode.value ? localSubscriptions.value : null),
    (rows) => {
      if (
        rows &&
        selected.value &&
        !rows.some((row) => row.id === selected.value)
      ) {
        const sourceReady = selected.value.startsWith("newsletter:")
          ? localNewsletter!.ready.value
          : localRss!.ready.value;
        if (sourceReady) void select("");
      }
    }
  );
  onScopeDispose(clear);

  const fetchPage = (source: string, after: string | null, history = false) =>
    request().get<FeedEntriesResponse>({
      url: "/v1/feed/entries",
      query: {
        ...(source ? { subscription_id: source } : {}),
        ...(after ? { cursor: after } : {}),
        ...(history ? { fetch_history: "1" } : {}),
        limit: "20",
      },
    });
  const reload = async (more = false) => {
    if (!enabled.value || loading.value || (more && !hasMore.value)) return;
    if (localMode.value) {
      if (!more) {
        reportLocalError();
        return;
      }
      const stamp = ++generation;
      loading.value = true;
      error.value = "";
      try {
        if (showsNewsletter.value && localNewsletter!.hasMore.value)
          localNewsletter!.loadMore();
        if (showsRss.value && localRss!.ready.value && localRss!.hasMore.value)
          await localRss!.loadMore();
      } catch (e) {
        if (stamp === generation) fail(e);
      } finally {
        if (stamp === generation) loading.value = false;
      }
      return;
    }
    const source = selected.value,
      stamp = ++generation,
      previous = cache.get(source);
    loading.value = true;
    error.value = "";
    try {
      if (more) {
        const result = await fetchPage(source, restCursor.value, true);
        if (stamp !== generation || !enabled.value || localMode.value) return;
        if (!result) throw new Error("source_unavailable");
      }
      // Revalidate every loaded page before swapping the list, preserving pagination and old rows while loading.
      // History from another source can belong above the old cursor; re-read the expanded window so none is skipped.
      let next: string | null = null,
        pages = 0,
        items: FeedEntry[] = [];
      const targetPages = (previous?.pages || 1) + (more ? 1 : 0);
      let page: FeedEntriesResponse;
      do {
        const result = await fetchPage(source, next);
        if (stamp !== generation || !enabled.value || localMode.value) return;
        if (!result) throw new Error("source_unavailable");
        page = result;
        items.push(...page.items.filter(allowed));
        next = page.next_cursor;
        pages++;
      } while (next && (page.cached_more ?? true) && pages < targetPages);
      const snapshot: CachedList = {
        items: [...new Map(items.map((item) => [item.id, item])).values()],
        cursor: next,
        pages,
        updatedAt: Date.now(),
        hasMore: page.has_more ?? !!next,
        historyStatus: page.history_status || "exhausted",
        retryAt: page.retry_at || null,
      };
      cache.set(source, snapshot);
      restoreList(snapshot);
    } catch (e) {
      if (stamp === generation) fail(e);
    } finally {
      if (stamp === generation) loading.value = false;
    }
  };
  const select = async (id: string, force = false) => {
    generation++;
    detailGeneration++;
    selected.value = id;
    detail.value = null;
    detailLoading.value = false;
    error.value = "";
    loading.value = false;
    const cached = cache.get(id);
    restoreList(cached);
    if (localMode.value) {
      reportLocalError();
      return;
    }
    if (force || !cached || Date.now() - cached.updatedAt >= CACHE_TTL)
      await reload();
  };
  const initialize = async (force = false) => {
    const initialization = ++initializeGeneration,
      account = session;
    initializing.value = true;
    error.value = "";
    try {
      try {
        await labs.fetch();
      } catch (e) {
        if (localMode.value) {
          reportLocalError();
          return;
        }
        throw e;
      }
      if (localMode.value) {
        reportLocalError();
        return;
      }
      if (
        !enabled.value ||
        initialization !== initializeGeneration ||
        account !== session ||
        localMode.value
      )
        return;
      const result = await request().get<FeedSubscriptionsResponse>({
        url: "/v1/feed/subscriptions",
      });
      if (
        initialization !== initializeGeneration ||
        account !== session ||
        localMode.value
      )
        return;
      if (!result) throw new Error("source_unavailable");
      const previous = new Map(
        restSubscriptions.value.map((row) => [row.id, row])
      );
      restSubscriptions.value = result.items.filter(allowed);
      const ids = new Set(restSubscriptions.value.map((row) => row.id));
      for (const [key, snapshot] of cache) {
        if (key && !ids.has(key)) {
          cache.delete(key);
          continue;
        }
        // Drop removed subscriptions immediately and keep user-assigned source names in every cached view.
        snapshot.items = snapshot.items
          .filter((row) => ids.has(row.subscription_id))
          .map((row) => ({
            ...row,
            source_title: feedSubscriptionName(
              result.items.find((sub) => sub.id === row.subscription_id)!
            ),
          }));
      }
      if (selected.value && !ids.has(selected.value)) {
        await select("");
        return;
      }
      const changed = result.items.some((row) => {
        const old = previous.get(row.id);
        return (
          (!selected.value || row.id === selected.value) &&
          (!old ||
            (row.kind === "rss" &&
              old.kind === "rss" &&
              (old.last_success_at !== row.last_success_at ||
                old.last_checked_at !== row.last_checked_at)))
        );
      });
      const cached = cache.get(selected.value);
      if (cached) {
        restoreList(cached);
      }
      if (
        !loading.value &&
        (force ||
          changed ||
          !cached ||
          Date.now() - cached.updatedAt >= CACHE_TTL)
      )
        await reload();
    } catch (e) {
      if (initialization === initializeGeneration && account === session)
        fail(e);
    } finally {
      if (initialization === initializeGeneration) initializing.value = false;
    }
  };
  const mutate = async (
    work: () => Promise<void>,
    entryId: string | null = null
  ) => {
    if (pending.value) return;
    const account = session,
      permission = permissionGeneration;
    pending.value = true;
    savingEntryId.value = entryId;
    error.value = "";
    try {
      await work();
      if (
        localMode.value &&
        account === session &&
        permission === permissionGeneration
      )
        error.value = "";
    } catch (e) {
      if (account === session && permission === permissionGeneration) fail(e);
    } finally {
      if (account === session && permission === permissionGeneration) {
        pending.value = false;
        savingEntryId.value = null;
      }
    }
  };
  const add = (url: string, remark = "") =>
    mutate(async () => {
      if (!rssEnabled.value) return;
      const account = session,
        permission = permissionGeneration;
      const row = await request().post<RssSubscription>({
        url: "/v1/rss/subscriptions",
        body: { url, remark: remark.trim() || null },
      });
      if (
        account !== session ||
        permission !== permissionGeneration ||
        !rssEnabled.value
      )
        return;
      if (!row) throw new Error("source_unavailable");
      if (localMode.value) localRss!.add(row);
      restSubscriptions.value = [
        ...restSubscriptions.value.filter((item) => item.id !== row.id),
        { ...row, kind: "rss" },
      ];
      cache.delete("");
      await select(row.id);
    });
  const update = (id: string, remark: string) =>
    mutate(async () => {
      if (
        !rssEnabled.value ||
        subscriptions.value.find((row) => row.id === id)?.kind === "newsletter"
      )
        return;
      const account = session,
        permission = permissionGeneration,
        previous = localMode.value ? localRss!.remark(id) : undefined;
      const row = await request().post<RssSubscription>({
        url: `/v1/rss/subscriptions/${encodeURIComponent(id)}/update`,
        body: { remark: remark.trim() || null },
      });
      if (
        account !== session ||
        permission !== permissionGeneration ||
        !rssEnabled.value
      )
        return;
      if (!row) throw new Error("source_unavailable");
      if (localMode.value) localRss!.rename(row, previous);
      restSubscriptions.value = restSubscriptions.value.map((sub) =>
        sub.id === row.id ? { ...row, kind: "rss" } : sub
      );
      const renamed = (entry: FeedEntry) =>
        entry.subscription_id === row.id
          ? { ...entry, source_title: feedSubscriptionName(row) }
          : entry;
      for (const snapshot of cache.values())
        snapshot.items = snapshot.items.map(renamed);
      restEntries.value = restEntries.value.map(renamed);
      if (detail.value?.subscription_id === row.id)
        detail.value = {
          ...detail.value,
          source_title: feedSubscriptionName(row),
        };
    });
  const remove = (id: string) =>
    mutate(async () => {
      if (
        !rssEnabled.value ||
        subscriptions.value.find((row) => row.id === id)?.kind === "newsletter"
      )
        return;
      const account = session,
        permission = permissionGeneration;
      await request().post({
        url: `/v1/rss/subscriptions/${encodeURIComponent(id)}/delete`,
      });
      if (
        account !== session ||
        permission !== permissionGeneration ||
        !rssEnabled.value
      )
        return;
      if (localMode.value) localRss!.remove(id);
      restSubscriptions.value = restSubscriptions.value.filter(
        (row) => row.id !== id
      );
      cache.delete(id);
      for (const snapshot of cache.values()) {
        snapshot.items = snapshot.items.filter(
          (row) => row.subscription_id !== id
        );
        snapshot.updatedAt = 0;
      }
      await select(selected.value === id ? "" : selected.value);
    });
  const refresh = () =>
    mutate(async () => {
      if (
        !rssEnabled.value ||
        subscriptions.value.find((row) => row.id === selected.value)?.kind ===
          "newsletter"
      )
        return;
      const id = selected.value,
        account = session,
        permission = permissionGeneration;
      if (!id) {
        if (!localMode.value) await initialize(true);
        return;
      }
      const result = await request().post<RssRefreshResponse>({
        url: `/v1/rss/subscriptions/${encodeURIComponent(id)}/refresh`,
      });
      if (
        account !== session ||
        permission !== permissionGeneration ||
        !rssEnabled.value
      )
        return;
      if (!result) throw new Error("source_unavailable");
      if (localMode.value) localRss!.refresh(id, result.next_allowed_at);
      const row = restSubscriptions.value.find((item) => item.id === id);
      if (row?.kind === "rss") {
        row.refreshing = true;
        row.next_allowed_at = result.next_allowed_at;
      }
    });
  const open = async (entry: FeedEntry) => {
    if (!allowed(entry)) return;
    const stamp = ++detailGeneration;
    detail.value = null;
    detailLoading.value = true;
    error.value = "";
    try {
      const result = await request().get<FeedEntryDetail>({
        url: `/v1/feed/entries/${encodeURIComponent(entry.id)}`,
      });
      if (stamp !== detailGeneration || !allowed(entry)) return;
      if (!result) throw new Error("source_unavailable");
      detail.value = result;
    } catch (e) {
      if (stamp === detailGeneration) fail(e);
    } finally {
      if (stamp === detailGeneration) detailLoading.value = false;
    }
  };
  const closePreview = () => {
    detailGeneration++;
    detail.value = null;
    detailLoading.value = false;
  };
  const save = (entry: FeedEntry) =>
    mutate(async () => {
      if (!enabled.value || !allowed(entry)) return;
      const account = session,
        permission = permissionGeneration,
        kind = entry.kind;
      const endpoint = kind === "newsletter" ? "feed" : "rss";
      const result = await request().post<RssSaveResponse>({
        url: `/v1/${endpoint}/entries/${encodeURIComponent(entry.id)}/save`,
      });
      if (
        account !== session ||
        permission !== permissionGeneration ||
        !enabled.value ||
        !allowed(entry)
      )
        return;
      if (!result?.bookmark_user_uuid) throw new Error("source_unavailable");
      if (localMode.value) {
        if (kind === "newsletter")
          localNewsletter!.save(entry.id, result.bookmark_user_uuid);
        else if (entry.article_url)
          localRss!.save(entry.article_url, result.bookmark_user_uuid);
      }
      const matches = (row: FeedEntry) =>
        row.kind === kind &&
        (kind === "newsletter"
          ? row.id === entry.id
          : !!entry.article_url && row.article_url === entry.article_url);
      const saved = (row: FeedEntry) =>
        matches(row)
          ? { ...row, bookmark_user_uuid: result.bookmark_user_uuid }
          : row;
      for (const snapshot of cache.values())
        snapshot.items = snapshot.items.map(saved);
      restEntries.value = restEntries.value.map(saved);
      if (detail.value && matches(detail.value))
        detail.value.bookmark_user_uuid = result.bookmark_user_uuid;
    }, entry.id);
  return {
    labs,
    subscriptions,
    entries,
    detail,
    selected,
    cursor,
    hasMore,
    historyStatus,
    retryAt,
    enabled,
    rssEnabled,
    newsletterEnabled,
    loading,
    initializing: computed(() => initializing.value || localPending.value),
    detailLoading,
    pending,
    savingEntryId,
    error,
    initialize,
    reload,
    select,
    add,
    update,
    remove,
    refresh,
    open,
    closePreview,
    save,
  };
}
