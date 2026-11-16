// @vitest-environment happy-dom
import * as Vue from "vue";

import FeedPanel from "../../../app/components/FeedPanel.vue";

import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Nuxt auto-imports must be intercepted with mockNuxtImport.
const { translate, mockUseI18n, mockUseLocalePath } = vi.hoisted(() => {
  const translate = (key: string) => key;
  return {
    translate,
    mockUseI18n: () => ({
      t: translate,
      locale: { value: "en" },
      te: () => true,
    }),
    mockUseLocalePath: () => (path: string) => path,
  };
});
mockNuxtImport("useI18n", () => mockUseI18n);
mockNuxtImport("useLocalePath", () => mockUseLocalePath);

let rss: any;
vi.mock("~/composables/useFeed", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../app/composables/useFeed")
  >()),
  useFeed: () => rss,
}));
vi.mock("~/stores/user", () => ({
  useUserStore: () => ({ userInfo: { userId: 1 } }),
}));
let labs: any;
vi.mock("~/composables/useLabFeatures", () => ({ useLabFeatures: () => labs }));
let localDatabase: any;
const presence = Vue.ref<any[]>([]);
vi.mock("@powersync/vue", () => ({
  useQuery: () => ({
    data: presence,
    isLoading: Vue.ref(false),
    error: Vue.ref(undefined),
  }),
}));
vi.mock("~/composables/rss/useRssLocalState", () => ({
  rssLocalDatabase: () => localDatabase,
  rssLocalOwned: () => Vue.computed(() => true),
}));
vi.mock("~/composables/bookmark/useSidebarCollapsed", () => ({
  useSidebarCollapsed: () => ({ collapsed: Vue.ref(false) }),
}));
const mounted: ReturnType<typeof mount>[] = [];
const source = {
  id: "a",
  kind: "rss",
  title: "Publisher",
  remark: "My feed",
  feed_url: "https://example.com/feed",
  site_url: null,
  next_allowed_at: "2020-01-01",
  last_success_at: null,
  refreshing: false,
};
const entry = {
  id: "1",
  subscription_id: "a",
  title: "Cached article",
  summary: "Summary",
  source_title: "My feed",
  article_url: "https://example.com/article",
  published_at: null,
  first_seen_at: "2026-09-23",
  image_url: null,
};
beforeEach(() => {
  labs = {
    loaded: Vue.ref(true),
    isEnabled: () => true,
    fetch: vi.fn().mockResolvedValue(undefined),
  };
  localDatabase = null;
  presence.value = [];
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
  rss = {
    enabled: Vue.ref(true),
    rssEnabled: Vue.ref(true),
    newsletterEnabled: Vue.ref(true),
    entries: Vue.ref([entry]),
    subscriptions: Vue.ref([source]),
    selected: Vue.ref("a"),
    cursor: Vue.ref(null),
    hasMore: Vue.ref(false),
    historyStatus: Vue.ref("exhausted"),
    retryAt: Vue.ref(null),
    detail: Vue.ref(null),
    loading: Vue.ref(false),
    initializing: Vue.ref(false),
    detailLoading: Vue.ref(false),
    pending: Vue.ref(false),
    savingEntryId: Vue.ref<string | null>(null),
    error: Vue.ref(""),
    initialize: vi.fn(),
    select: vi.fn(),
    reload: vi.fn(),
    refresh: vi.fn(),
    add: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
    save: vi.fn(),
    open: vi.fn(),
    closePreview: vi.fn(),
  };
});
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function panel() {
  const wrapper = mount(FeedPanel, {
    props: { active: true, search: "", listMode: "card" },
    global: {
      mocks: { $t: translate },
      stubs: {
        NewsletterAddress: true,
        RssPanel: { template: "<div data-legacy-rss />" },
        NuxtLink: { template: "<a><slot /></a>" },
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

describe("Newsletter Feed", () => {
  it.each([null, 'slax-newsletter://message/1', 'mailto:a@example.com'])('hides non-HTTP originals in the preview: %s', async url => {
    rss.entries.value = [{ ...entry, id: 'newsletter:1', kind: 'newsletter', article_url: url }];
    const wrapper = panel();
    await wrapper.get('.article-main').trigger('click');
    expect(wrapper.find('.reader-footer a.text-button').exists()).toBe(false);
  });

  it("shows the active mail's save progress in list and preview, then allows retry", async () => {
    const mail = {
      ...entry,
      id: "newsletter:1",
      kind: "newsletter",
      article_url: null,
    };
    rss.entries.value = [mail, { ...mail, id: "newsletter:2" }];
    const wrapper = panel();
    await wrapper.findAll(".article-main")[0].trigger("click");
    rss.pending.value = true;
    rss.savingEntryId.value = mail.id;
    await Vue.nextTick();

    const saves = wrapper.findAll("article .save-action");
    const previewSave = wrapper.get(".reader-footer button");
    for (const button of [saves[0], previewSave]) {
      expect(button.text()).toBe("rss.saving");
      expect(button.attributes("aria-busy")).toBe("true");
      expect(button.attributes("disabled")).toBeDefined();
      expect(button.find(".spinning").exists()).toBe(true);
      await button.trigger("click");
    }
    expect(rss.save).not.toHaveBeenCalled();
    expect(saves[1].text()).toBe("rss.save");
    expect(saves[1].find(".spinning").exists()).toBe(false);

    rss.pending.value = false;
    rss.savingEntryId.value = null;
    await Vue.nextTick();
    for (const button of [saves[0], previewSave]) {
      expect(button.text()).toBe("rss.save");
      expect(button.attributes("aria-busy")).toBe("false");
      expect(button.attributes("disabled")).toBeUndefined();
      expect(button.find(".spinning").exists()).toBe(false);
    }
  });
  it("saves URL-less mail from both list and preview and shows the saved route", async () => {
    const mail = {
      ...entry,
      id: "newsletter:1",
      kind: "newsletter",
      article_url: null,
      bookmark_user_uuid: null,
    };
    rss.entries.value = [mail];
    const wrapper = panel();
    const save = wrapper.get("article .save-action");
    expect(save.attributes("disabled")).toBeUndefined();
    await save.trigger("click");
    expect(rss.save).toHaveBeenCalledWith(mail);
    await wrapper.get(".article-main").trigger("click");
    expect(
      wrapper.get(".reader-footer button").attributes("disabled"),
    ).toBeUndefined();
    await wrapper.get(".reader-footer button").trigger("click");
    expect(rss.save).toHaveBeenCalledTimes(2);
    rss.entries.value = [{ ...mail, bookmark_user_uuid: "saved-copy" }];
    await Vue.nextTick();
    expect(wrapper.get("article .saved").attributes("to")).toBe(
      "/b/saved-copy",
    );
    expect(wrapper.get(".reader-footer .rss-button").attributes("to")).toBe(
      "/b/saved-copy",
    );
  });
  it("delegates RSS-only sessions to the unchanged RSS panel", async () => {
    rss.newsletterEnabled.value = false;
    const wrapper = panel();
    expect(wrapper.find("[data-legacy-rss]").exists()).toBe(true);
    expect(wrapper.find(".rss-panel").exists()).toBe(false);
  });
});

it('revalidates saved identities immediately when returning from Inbox', async () => {
  const wrapper=panel()
  await wrapper.setProps({active:false})
  rss.initialize.mockClear()
  await wrapper.setProps({active:true})
  expect(rss.initialize).toHaveBeenLastCalledWith(true)
})

it('queues activation revalidation until an older request becomes idle', async () => {
  const wrapper=panel()
  rss.loading.value=true
  await wrapper.setProps({active:false})
  rss.initialize.mockClear()
  await wrapper.setProps({active:true})
  expect(rss.initialize).not.toHaveBeenCalled()
  rss.loading.value=false
  await Vue.nextTick()
  expect(rss.initialize).toHaveBeenLastCalledWith(true)
})
