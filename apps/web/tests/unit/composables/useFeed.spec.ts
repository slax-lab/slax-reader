import { effectScope, nextTick, reactive, ref } from "vue";

import { useFeed } from "../../../app/composables/useFeed";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
let labs: any, user: any;
vi.mock("~/composables/useLabFeatures", () => ({ useLabFeatures: () => labs }));
vi.mock("~/stores/user", () => ({ useUserStore: () => user }));
vi.mock("~/composables/rss/useRssLocalState", () => ({ rssLocalDatabase: () => null }));
const { get, post, mockRequest } = vi.hoisted(() => {
  const get = vi.fn(),
    post = vi.fn();
  return { get, post, mockRequest: vi.fn(() => ({ get, post })) };
});
mockNuxtImport("request", () => mockRequest);
const scopes: ReturnType<typeof effectScope>[] = [];
const mail = (id: string) => ({
  id,
  kind: "newsletter",
  subscription_id: "newsletter:sender",
  title: id,
  summary: "",
  source_title: "Sender",
  article_url: null,
  bookmark_user_uuid: null,
});
const create = () => {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() => useFeed())!;
};
beforeEach(() => {
  const newsletter = ref(true),
    rss = ref(true);
  labs = {
    loaded: ref(true),
    features: ref([]),
    isEnabled: (key: string) =>
      key === "newsletter" ? newsletter.value : rss.value,
    fetch: vi.fn(),
    newsletter,
    rss,
  };
  user = reactive({ userInfo: { userId: 1 } });
  get.mockReset();
  post.mockReset();
  get.mockImplementation(async () => ({
    items: [],
    next_cursor: null,
    has_more: false,
    cached_more: false,
    history_status: "exhausted",
  }));
});
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.restoreAllMocks();
});
test("save progress lasts for the request, blocks a duplicate, and clears on failure", async () => {
  const feed = create();
  let rejectSave!: (error: Error) => void;
  post.mockReturnValueOnce(new Promise((_, reject) => {
    rejectSave = reject;
  }));
  const saving = feed.save(mail("newsletter:1") as never);
  expect(feed.savingEntryId.value).toBe("newsletter:1");
  expect(feed.pending.value).toBe(true);
  await feed.save(mail("newsletter:1") as never);
  expect(post).toHaveBeenCalledTimes(1);
  rejectSave(new Error("source_unavailable"));
  await saving;
  expect(feed.savingEntryId.value).toBeNull();
  expect(feed.pending.value).toBe(false);
  post.mockResolvedValueOnce({ bookmark_user_uuid: "retry" });
  await feed.save(mail("newsletter:1") as never);
  expect(post).toHaveBeenCalledTimes(2);
  expect(feed.savingEntryId.value).toBeNull();
});
test("saving a URL-less mail updates only its own identity in list and preview", async () => {
  const feed = create();
  get.mockResolvedValueOnce({
    items: [mail("newsletter:1"), mail("newsletter:2")],
    next_cursor: null,
    has_more: false,
  });
  await feed.reload();
  get.mockResolvedValueOnce({ ...mail("newsletter:1"), content_html: "body" });
  await feed.open(feed.entries.value[0]);
  post.mockResolvedValueOnce({
    bookmark_user_uuid: "saved",
    result: "created",
    processing_status: "ready",
  });
  await feed.save(feed.entries.value[0]);
  expect(feed.entries.value.map((row) => row.bookmark_user_uuid)).toEqual([
    "saved",
    null,
  ]);
  expect(feed.detail.value?.bookmark_user_uuid).toBe("saved");
  expect(post.mock.calls[0][0].url).toBe(
    "/v1/feed/entries/newsletter%3A1/save",
  );
});
test("failed save keeps mail unsaved and a later explicit retry succeeds", async () => {
  const feed = create();
  get.mockResolvedValueOnce({
    items: [mail("newsletter:1")],
    next_cursor: null,
  });
  await feed.reload();
  post.mockRejectedValueOnce(new Error("source_unavailable"));
  await feed.save(feed.entries.value[0]);
  expect(feed.entries.value[0].bookmark_user_uuid).toBeNull();
  expect(feed.error.value).toBe("source_unavailable");
  post.mockResolvedValueOnce({ bookmark_user_uuid: "retry" });
  await feed.save(feed.entries.value[0]);
  expect(feed.entries.value[0].bookmark_user_uuid).toBe("retry");
});
test("a late save response cannot alter another account or a disabled Newsletter session", async () => {
  const feed = create();
  get.mockResolvedValueOnce({
    items: [mail("newsletter:1")],
    next_cursor: null,
  });
  await feed.reload();
  let finish!: (v: any) => void;
  post.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const saving = feed.save(feed.entries.value[0]);
  labs.newsletter.value = false;
  await nextTick();
  finish({ bookmark_user_uuid: "late" });
  await saving;
  expect(feed.entries.value).toEqual([]);
  expect(feed.enabled.value).toBe(false);
});
test("RSS-only mode makes no mixed REST reads while its legacy panel owns state", async () => {
  labs.newsletter.value = false;
  const feed = create();
  await feed.initialize();
  await feed.reload();
  expect(get).not.toHaveBeenCalled();
  expect(feed.rssEnabled.value).toBe(true);
});
test("history probe is followed by an atomic expanded-window reread from the head", async () => {
  const feed = create();
  get.mockResolvedValueOnce({
    items: [mail("newsletter:1")],
    next_cursor: "old",
    has_more: true,
    cached_more: true,
  });
  await feed.reload();
  get
    .mockResolvedValueOnce({ items: [], next_cursor: null })
    .mockResolvedValueOnce({
      items: [mail("newsletter:3")],
      next_cursor: "new",
      has_more: true,
      cached_more: true,
    })
    .mockResolvedValueOnce({
      items: [mail("newsletter:1")],
      next_cursor: null,
      has_more: false,
      cached_more: false,
    });
  await feed.reload(true);
  expect(feed.entries.value.map((row) => row.id)).toEqual([
    "newsletter:3",
    "newsletter:1",
  ]);
  expect(get.mock.calls[1][0].query.fetch_history).toBe("1");
  expect(get.mock.calls[2][0].query.cursor).toBeUndefined();
});

test("disable then re-enable also fences an older save response", async () => {
  const feed = create();
  get.mockResolvedValueOnce({
    items: [mail("newsletter:1")],
    next_cursor: null,
  });
  await feed.reload();
  let finish!: (v: any) => void;
  post.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const saving = feed.save(feed.entries.value[0]);
  labs.newsletter.value = false;
  labs.newsletter.value = true;
  feed.entries.value = [mail("newsletter:1") as never];
  expect(feed.savingEntryId.value).toBeNull();
  let finishNew!: (value: unknown) => void;
  post.mockReturnValueOnce(new Promise(resolve => { finishNew = resolve; }));
  const newSaving = feed.save(mail("newsletter:2") as never);
  finish({ bookmark_user_uuid: "late" });
  await saving;
  expect(feed.entries.value.every((row) => !row.bookmark_user_uuid)).toBe(true);
  expect(feed.savingEntryId.value).toBe("newsletter:2");
  expect(feed.pending.value).toBe(true);
  finishNew({ bookmark_user_uuid: "current" });
  await newSaving;
  expect(feed.savingEntryId.value).toBeNull();
});
