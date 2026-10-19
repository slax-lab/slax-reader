<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useI18n } from "vue-i18n";
import { useLibrary } from "../stores/library";
import { ipc } from "../ipc/client";
import { outlineRows } from "../outline";
import { frameMessage, selectionFrom } from "../reader-protocol";
import type { Annotation, Selection } from "../ipc/generated";
import Icon from "./Icon.vue";
import Dialog from "./Dialog.vue";
const store = useLibrary(),
  { t, te } = useI18n();
const frame = ref<HTMLIFrameElement>(),
  notes = ref(false),
  annotations = ref<Annotation[]>([]),
  selection = ref<Selection | null>(null),
  comment = ref(""),
  commenting = ref(false),
  replyTo = ref<string | null>(null),
  busy = ref(false),
  rename = ref(false),
  title = ref(""),
  tagging = ref(false),
  tagIds = ref<string[]>([]),
  newTag = ref(""),
  more = ref(false),
  aiKind = ref<"overview" | "outline" | null>(null),
  aiText = ref(""),
  takeaways = ref<string[]>([]),
  aiBusy = ref(false),
  aiError = ref(""),
  gallery = ref(false),
  images = ref<string[]>([]),
  image = ref(""),
  sharing = ref(false),
  shareEnabled = ref(false),
  shareLine = ref(true),
  shareComment = ref(true),
  shareProfile = ref(true),
  shareUrl = ref("");
let epoch = 0,
  marksEpoch = 0,
  aiId: string | undefined,
  aiRun = 0,
  marksWatch: string | undefined,
  drawn = "",
  readyTimer: ReturnType<typeof setTimeout> | undefined;
const ready = ref(false),
  layout = ref(0);
const outline = computed(() => outlineRows(aiText.value));
const selectionStyle = computed(() => {
  void layout.value;
  if (!selection.value || !frame.value) return {};
  const rect = frame.value.getBoundingClientRect(),
    pane = frame.value.closest(".reader-pane")!.getBoundingClientRect(),
    s = selection.value.rect;
  return {
    left: `${Math.max(140, Math.min(pane.width - 140, rect.left - pane.left + s.x + s.width / 2))}px`,
    top: `${Math.max(80, Math.min(pane.height - 60, rect.top - pane.top + s.y + s.height + 8))}px`,
    bottom: "auto",
  };
});
function anchor(value: string) {
  if (doc.value?.pdf) pdf("anchor", { anchor: value });
  else bridge("scrollToAnchor", value);
  aiKind.value = null;
}
const doc = computed(() => store.document);
const stale = computed(
  () => !!doc.value && doc.value.bookmarkId !== store.selected,
);
const progress = new Map<
  string,
  {
    generation: string;
    pdf: boolean;
    value: number;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function saveProgress(
  generation: string,
  handle: string,
  pdf: boolean,
  value: number,
) {
  const entry = progress.get(handle);
  if (entry) clearTimeout(entry.timer);
  progress.set(handle, {
    generation,
    pdf,
    value,
    timer: setTimeout(() => void flushProgress(handle), 1000),
  });
}
async function flushProgress(handle: string) {
  const entry = progress.get(handle);
  if (!entry) return;
  clearTimeout(entry.timer);
  progress.delete(handle);
  await (
    entry.pdf
      ? ipc.pdfProgress(entry.generation, handle, entry.value)
      : ipc.progress(entry.generation, handle, entry.value)
  ).catch(() => {});
}
const flushAll = () => {
  for (const handle of [...progress.keys()]) void flushProgress(handle);
};
const visibility = () => {
  if (document.visibilityState === "hidden") flushAll();
};
const stopRelease = store.beforeClose(flushProgress);
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
const resized = () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => layout.value++, 120);
};
const visibleTags = computed(() =>
  (store.current?.tags ?? [])
    .map((id) => store.snapshot?.tags.find((v) => v.id === id))
    .filter((v): v is { id: string; name: string } => !!v),
);
const errorText = (code: string) =>
  t(te(`errors.${code}`) ? `errors.${code}` : "errors.default");
function sourceHost(raw: string) {
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}
function json(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function quote(mark: Annotation) {
  const content = json(mark.content);
  return Array.isArray(content)
    ? content.map((v) => (typeof v?.text === "string" ? v.text : "")).join("")
    : "";
}
function bridge(operation: string, argument?: unknown) {
  if (!doc.value) return;
  frame.value?.contentWindow?.postMessage(
    {
      channel: "slax-reader-host",
      pageId: doc.value.pageId,
      requestId: crypto.randomUUID(),
      operation,
      argument,
    },
    "*",
  );
}
function pdf(kind: string, extra: Record<string, unknown> = {}) {
  if (doc.value)
    frame.value?.contentWindow?.postMessage(
      { channel: "slax-pdf-host", pageId: doc.value.pageId, kind, ...extra },
      "*",
    );
}
function marksForFrame() {
  return annotations.value
    .filter((v) => v.source)
    .map((v) => {
      const source = json(v.source);
      return {
        id: v.id,
        source: Array.isArray(source)
          ? source.map((p) =>
              p.type === "pdf"
                ? p
                : {
                    path: p.path ?? p.xpath,
                    type: p.type,
                    start: p.start ?? p.start_offset,
                    end: p.end ?? p.end_offset,
                  },
            )
          : [],
        stroke: v.kind === 1 ? [{ userId: 1 }] : [],
        comments: [],
        approx: json(v.approxSource),
      };
    });
}
function applyMarks(marks: Annotation[], force = false) {
  const current = doc.value;
  if (!current) return;
  const key = JSON.stringify(marks);
  if (!force && key === drawn) return;
  drawn = key;
  annotations.value = marks;
  if (current.pdf) pdf("marks", { marks: marksForFrame() });
  else bridge("drawMarks", marksForFrame());
}
async function loadMarks() {
  const current = doc.value,
    generation = store.auth.generation,
    expected = epoch,
    request = ++marksEpoch;
  if (!current) return;
  try {
    const marks = await ipc.marks(generation, current.handle);
    if (expected !== epoch || request !== marksEpoch) return;
    applyMarks(marks);
  } catch (e) {
    if (expected === epoch) store.fail(e);
  }
}
function stopMarks() {
  if (marksWatch) void ipc.marksUnwatch(marksWatch).catch(() => {});
  marksWatch = undefined;
}
function stopAi() {
  aiRun++;
  aiBusy.value = false;
  if (aiId) void ipc.unwatch(aiId).catch(() => {});
  aiId = undefined;
}
function closeAi() {
  aiKind.value = null;
  stopAi();
}
watch(
  () => store.document,
  async (current, old) => {
    epoch++;
    selection.value = null;
    annotations.value = [];
    comment.value = "";
    commenting.value = false;
    aiText.value = "";
    takeaways.value = [];
    aiKind.value = null;
    images.value = [];
    more.value = false;
    drawn = "";
    ready.value = false;
    clearTimeout(readyTimer);
    stopAi();
    stopMarks();
    if (current) {
      const expected = epoch,
        generation = store.auth.generation;
      readyTimer = setTimeout(() => (ready.value = true), 1200);
      void ipc
        .images(generation, current.handle)
        .then((value) => {
          if (current.pageId === doc.value?.pageId) images.value = value;
        })
        .catch(() => {});
      void ipc.event(generation, "bookmark_open").catch(() => {});
      void ipc
        .marksWatch(generation, current.handle, (marks) => {
          if (expected === epoch) applyMarks(marks);
        })
        .then((id) => {
          if (expected === epoch) marksWatch = id;
          else void ipc.marksUnwatch(id).catch(() => {});
        })
        .catch((e) => {
          if (expected === epoch) store.fail(e);
        });
    }
  },
  { immediate: true },
);
async function mark(kind: number) {
  const current = doc.value;
  if (!current || busy.value) return;
  busy.value = true;
  const expected = epoch;
  try {
    await ipc.mark(
      store.auth.generation,
      current.handle,
      kind,
      selection.value,
      comment.value,
      replyTo.value,
    );
    if (expected !== epoch) return;
    comment.value = "";
    commenting.value = false;
    replyTo.value = null;
    selection.value = null;
    bridge("clearSelection");
    pdf("clearSelection");
    await loadMarks();
    notes.value = true;
  } catch (e) {
    if (expected === epoch) store.fail(e);
  } finally {
    busy.value = false;
  }
}
async function remove(mark: Annotation) {
  if (!doc.value) return;
  try {
    await ipc.deleteMark(store.auth.generation, doc.value.handle, mark.id);
    await loadMarks();
  } catch (e) {
    store.fail(e);
  }
}
async function message(event: MessageEvent) {
  const current = doc.value;
  if (!current) return;
  const payload = frameMessage(
    event,
    frame.value?.contentWindow ?? null,
    current.pageId,
  );
  if (!payload) return;
  const expected = epoch,
    generation = store.auth.generation;
  if (current.pdf) {
    if (
      payload.kind === "position" &&
      typeof payload.position === "number" &&
      Number.isFinite(payload.position)
    ) {
      saveProgress(generation, current.handle, true, payload.position);
      return;
    }
    if (payload.kind === "contextMenu") {
      void ipc
        .readerContext(generation, current.handle, selection.value, null)
        .catch(store.fail);
      return;
    }
    if (
      payload.kind === "range" &&
      typeof payload.id === "string" &&
      typeof payload.begin === "number" &&
      typeof payload.end === "number" &&
      Number.isSafeInteger(payload.begin) &&
      Number.isSafeInteger(payload.end) &&
      payload.begin >= 0 &&
      payload.end > payload.begin &&
      payload.end <= current.pdf.size
    ) {
      const id = payload.id,
        begin = payload.begin,
        end = payload.end;
      if (end - begin > 8 * 1024 * 1024) return;
      try {
        const chunks: ArrayBuffer[] = [];
        for (let offset = begin; offset < end; offset += 1024 * 1024) {
          const right = Math.min(end, offset + 1024 * 1024);
          const bytes = await ipc.range(
            generation,
            current.handle,
            current.pdf.documentId,
            offset,
            right,
          );
          if (expected !== epoch) return;
          if (
            !(bytes instanceof ArrayBuffer) ||
            bytes.byteLength !== right - offset
          )
            throw Error("PDF_RANGE_INVALID");
          chunks.push(bytes);
        }
        let data = chunks[0]!;
        if (chunks.length > 1) {
          const joined = new Uint8Array(end - begin);
          let offset = 0;
          for (const chunk of chunks) {
            joined.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }
          data = joined.buffer;
        }
        frame.value?.contentWindow?.postMessage(
          {
            channel: "slax-pdf-host",
            pageId: current.pageId,
            kind: "range",
            id,
            data,
          },
          "*",
          [data],
        );
      } catch {
        if (expected === epoch) pdf("rangeError", { id });
      }
      return;
    }
    if (
      payload.kind === "event" &&
      payload.event &&
      typeof payload.event === "object"
    ) {
      const e = payload.event as Record<string, unknown>;
      if (e.type === "domReady") {
        ready.value = true;
        applyMarks(annotations.value, true);
      }
      if (e.type === "textDeselected") selection.value = null;
      if (e.type === "textSelected") {
        const geometry = e.selectionGeometry as
          { top?: number; bottom?: number } | undefined;
        selection.value = selectionFrom(e.selection, {
          x: 20,
          y: geometry?.top ?? 80,
          width: 150,
          height: 20,
        });
      }
      if (e.type === "readingProgress" && typeof e.progress === "number")
        saveProgress(generation, current.handle, false, e.progress);
    }
    return;
  }
  switch (payload.type) {
    case "context":
      void ipc
        .readerContext(
          generation,
          current.handle,
          selection.value,
          typeof payload.url === "string" ? payload.url : null,
        )
        .catch(store.fail);
      break;
    case "domReady":
      ready.value = true;
      applyMarks(annotations.value, true);
      break;
    case "textSelected":
      selection.value = selectionFrom(payload.selection, payload.rect);
      break;
    case "textDeselected":
      if (!commenting.value) selection.value = null;
      break;
    case "link":
      if (typeof payload.url === "string")
        void ipc
          .external(generation, current.handle, payload.url)
          .catch(store.fail);
      break;
    case "image":
      if (
        typeof payload.url === "string" &&
        payload.url.startsWith(`slaximg://localhost/${current.handle}/`)
      ) {
        image.value = payload.url;
        if (!images.value.includes(image.value)) images.value.push(image.value);
        gallery.value = true;
      }
      break;
    case "progress":
      if (typeof payload.value === "number")
        saveProgress(generation, current.handle, false, payload.value);
      break;
  }
}
let unlistenMenu: UnlistenFn | undefined;
onMounted(async () => {
  unlistenMenu = await listen<{ handle: string; operation: string }>(
    "reader-menu",
    (event) => {
      if (
        event.payload.handle === doc.value?.handle &&
        event.payload.operation === "comment"
      ) {
        commenting.value = true;
        comment.value = "";
      }
    },
  );
});
window.addEventListener("message", message);
window.addEventListener("resize", resized);
document.addEventListener("visibilitychange", visibility);
onBeforeUnmount(() => {
  epoch++;
  unlistenMenu?.();
  clearTimeout(readyTimer);
  clearTimeout(resizeTimer);
  window.removeEventListener("message", message);
  window.removeEventListener("resize", resized);
  document.removeEventListener("visibilitychange", visibility);
  flushAll();
  stopRelease();
  stopMarks();
  stopAi();
});
async function runAi(kind: "overview" | "outline", force = false) {
  if (!doc.value) return;
  stopAi();
  const expected = epoch,
    run = aiRun;
  aiKind.value = kind;
  aiText.value = "";
  aiError.value = "";
  aiBusy.value = true;
  let buffered = "",
    replace = false,
    raf = 0;
  const flush = () => {
    raf = 0;
    if (run !== aiRun || expected !== epoch) return;
    aiText.value = replace ? buffered : aiText.value + buffered;
    buffered = "";
    replace = false;
  };
  try {
    const id = await ipc.ai(
      store.auth.generation,
      doc.value.handle,
      kind,
      force,
      (value) => {
        if (run !== aiRun || expected !== epoch) return;
        if (value.text) {
          if (value.replace) {
            buffered = value.text;
            replace = true;
          } else buffered += value.text;
          if (!raf) raf = requestAnimationFrame(flush);
        }
        if (value.takeaways?.length) takeaways.value = value.takeaways;
        if (value.done) {
          cancelAnimationFrame(raf);
          flush();
          aiBusy.value = false;
          aiId = undefined;
          if (value.error) aiError.value = errorText(value.error);
        }
      },
    );
    if (run === aiRun && aiBusy.value) aiId = id;
    else if (run !== aiRun) void ipc.unwatch(id).catch(() => {});
  } catch (e) {
    if (run !== aiRun) return;
    aiBusy.value = false;
    aiError.value = errorText((e as { code?: string }).code ?? "default");
  }
}
async function saveRename() {
  if (!store.current) return;
  await store.mutate(store.current, { kind: "rename", value: title.value });
  rename.value = false;
}
async function saveTags() {
  if (!store.current) return;
  if (newTag.value.trim()) {
    const id = await ipc.tag(store.auth.generation, newTag.value);
    tagIds.value.push(id);
    newTag.value = "";
  }
  await store.mutate(store.current, { kind: "tags", value: tagIds.value });
  tagging.value = false;
}
async function openShare() {
  if (!doc.value) return;
  sharing.value = true;
  try {
    const state = await ipc.share(
      store.auth.generation,
      doc.value.handle,
      "get",
    );
    shareEnabled.value = state.enabled;
    shareLine.value = state.showLine;
    shareComment.value = state.showComment;
    shareProfile.value = state.showProfile;
    shareUrl.value = state.url;
  } catch (e) {
    store.fail(e);
  }
}
async function saveShare() {
  if (!doc.value) return;
  try {
    const state = await ipc.share(
      store.auth.generation,
      doc.value.handle,
      "save",
      {
        enabled: shareEnabled.value,
        showLine: shareLine.value,
        showComment: shareLine.value,
        showProfile: shareProfile.value,
      },
    );
    shareUrl.value = state.url;
  } catch (e) {
    store.fail(e);
  }
}
async function cache() {
  if (!doc.value) return;
  busy.value = true;
  try {
    await ipc.download(store.auth.generation, doc.value.handle);
  } catch (e) {
    store.fail(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="reader-pane">
    <header class="toolbar" data-tauri-drag-region>
      <template v-if="store.current"
        ><button
          class="icon-button"
          v-if="!store.current.ownerId"
          :class="{ accent: store.current.starred }"
          :aria-label="t(store.current.starred ? 'unstar' : 'star')"
          @click="
            store.mutate(store.current, {
              kind: 'star',
              value: !store.current.starred,
            })
          "
        >
          <Icon name="star" /></button
        ><button
          v-if="!store.current.ownerId"
          class="icon-button"
          :aria-label="t(store.current.archived ? 'unarchive' : 'archive')"
          @click="
            store.mutate(store.current, {
              kind: 'archive',
              value: !store.current.archived,
            })
          "
        >
          <Icon name="archive" /></button
        ><span v-if="!store.current.ownerId" class="toolbar-divider" />
        <span class="spacer" /><button
          class="icon-button"
          :disabled="!doc"
          :aria-label="t('overview')"
          @click="runAi('overview')"
        >
          <Icon name="spark" /></button
        ><button
          class="outline-button"
          :disabled="!doc"
          @click="runAi('outline')"
        >
          {{ t("outline") }}</button
        ><span class="toolbar-divider" /><button
          class="icon-button"
          :class="{ accent: notes }"
          :disabled="!doc || !store.current.showAnnotations"
          :aria-label="t('notes')"
          @click="notes = !notes"
        >
          <Icon name="note" /></button
        ><button
          class="icon-button"
          :disabled="!doc"
          :aria-label="t('share')"
          v-if="!store.current.ownerId"
          @click="openShare"
        >
          <Icon name="link" /></button
        ><button
          class="icon-button"
          :aria-label="t('settings')"
          @click="more = !more"
        >
          <Icon name="more" /></button
      ></template>
    </header>
    <div
      v-if="store.current && (visibleTags.length || !store.current.ownerId)"
      class="reader-tags"
    >
      <button
        v-for="tag in visibleTags"
        :key="tag.id"
        :disabled="!!store.current.ownerId"
        :aria-pressed="store.selectedTags.includes(tag.id)"
        @click="store.toggleTag(tag.id)"
      >
        <Icon name="tag" :size="12" />{{ tag.name }}
      </button>
      <button
        v-if="!store.current.ownerId"
        class="edit-tags"
        :aria-label="t('editTags')"
        @click="
          tagIds = [...store.current.tags];
          tagging = true;
        "
      >
        <Icon :name="visibleTags.length ? 'plus' : 'tag'" :size="12" />{{
          t(visibleTags.length ? "editTags" : "addTags")
        }}
      </button>
    </div>
    <div v-if="more && store.current" class="reader-more">
      <button
        v-if="!store.current.ownerId"
        @click="
          title = store.current.title;
          rename = true;
          more = false;
        "
      >
        {{ t("rename") }}</button
      ><button
        v-if="!store.current.ownerId"
        @click="
          tagIds = [...store.current.tags];
          tagging = true;
          more = false;
        "
      >
        {{ t("tags") }}</button
      ><button
        v-if="images.length"
        @click="
          image = images[0]!;
          gallery = true;
          more = false;
        "
      >
        {{ t("gallery") }}</button
      ><button
        :disabled="!doc || busy"
        @click="
          cache();
          more = false;
        "
      >
        {{ t("download") }}</button
      ><button
        @click="
          store.current &&
            ipc
              .original(store.auth.generation, store.current.id)
              .catch(store.fail);
          more = false;
        "
      >
        {{ t("original") }}</button
      ><button
        class="danger"
        v-if="!store.current.ownerId"
        @click="
          store.mutate(store.current, { kind: 'delete' });
          more = false;
        "
      >
        {{ t("delete") }}
      </button>
    </div>
    <div
      v-if="store.current && store.current.status !== 'success'"
      class="processing-state"
    >
      <span class="source-label">{{ sourceHost(store.current.url) }}</span>
      <h1>{{ store.current.title || store.current.url }}</h1>
      <div class="processing-card" role="status">
        <Icon
          :name="store.current.status === 'failed' ? 'warning' : 'clock'"
          :size="28"
        />
        <h2>
          {{
            t(
              store.current.status === "failed"
                ? "articleFailed"
                : store.current.status === "updating"
                  ? "articleUpdating"
                  : "articleProcessing",
            )
          }}
        </h2>
        <p>
          {{
            t(
              store.current.status === "failed"
                ? "articleFailedBody"
                : "articlePendingBody",
            )
          }}
        </p>
        <button
          @click="
            ipc
              .original(store.auth.generation, store.current!.id)
              .catch(store.fail)
          "
        >
          {{ t("original") }} ↗
        </button>
      </div>
    </div>
    <div v-else-if="store.readerLoading" class="empty" role="status">
      {{ t("loading") }}
    </div>
    <div v-else-if="store.readerError" class="empty">
      <p class="error" role="alert">{{ errorText(store.readerError) }}</p>
      <button @click="store.select(store.selected)">{{ t("retry") }}</button>
    </div>
    <div v-else-if="!doc" class="empty reader-empty">
      <div class="reader-glyph"><Icon name="book" :size="26" /></div>
      <h2>{{ t("select") }}</h2>
      <p>{{ t("selectBody") }}</p>
      <span class="reader-hint"><kbd>⌘N</kbd>{{ t("add") }}</span>
    </div>
    <template v-else>
      <div class="reader-body">
        <iframe
          ref="frame"
          :key="doc.pageId"
          :src="doc.url"
          sandbox="allow-scripts"
          :title="doc.title"
          referrerpolicy="no-referrer"
          class="article-frame"
          :class="{ ready, stale }"
        />
        <aside
          v-if="notes && store.current?.showAnnotations"
          class="notes-pane"
        >
          <h3>
            {{ t("notes") }} <span>{{ annotations.length }}</span
            ><button
              class="icon-button"
              :aria-label="t('close')"
              @click="notes = false"
            >
              <Icon name="close" :size="14" />
            </button>
          </h3>
          <div v-if="!annotations.length" class="empty">
            <Icon name="note" :size="24" />
            <p>{{ t("noNotes") }}</p>
            <small>{{ t("noNotesBody") }}</small>
          </div>
          <article
            v-for="mark in annotations"
            :key="mark.id"
            class="annotation"
          >
            <blockquote v-if="quote(mark)">{{ quote(mark) }}</blockquote>
            <p>{{ mark.comment }}</p>
            <div class="note-actions">
              <button
                @click="
                  replyTo = mark.id;
                  commenting = true;
                  comment = '';
                "
              >
                {{ t("reply") }}</button
              ><button class="danger" @click="remove(mark)">
                {{ t("delete") }}
              </button>
            </div>
          </article>
          <button
            class="note-add"
            @click="
              replyTo = null;
              commenting = true;
              selection = null;
            "
          >
            <Icon name="plus" :size="14" />{{ t("comment") }}
          </button>
        </aside>
      </div>
      <div
        v-if="selection && !commenting"
        class="selection-tools"
        :style="selectionStyle"
      >
        <button
          :disabled="busy || !store.current?.canAnnotate"
          @mousedown.prevent
          @click="mark(1)"
        >
          <Icon name="note" :size="14" />{{ t("highlight") }}</button
        ><button
          :disabled="!store.current?.canAnnotate"
          @mousedown.prevent
          @click="
            commenting = true;
            comment = '';
          "
        >
          {{ t("comment") }}</button
        ><button
          @mousedown.prevent
          @click="
            ipc
              .copy(store.auth.generation, doc!.handle, selection!.text)
              .catch(store.fail)
          "
        >
          {{ t("copy") }}
        </button>
      </div>
    </template>
  </section>
  <Dialog
    v-if="commenting"
    :title="t(replyTo ? 'reply' : 'comment')"
    @close="commenting = false"
    ><blockquote v-if="selection" class="selected-quote">
      {{ selection.text }}
    </blockquote>
    <textarea
      v-model="comment"
      :placeholder="t('writeNote')"
      :aria-label="t('comment')"
      maxlength="20000"
    />
    <div class="actions">
      <button @click="commenting = false">{{ t("cancel") }}</button
      ><button
        class="primary"
        :disabled="busy || !comment.trim()"
        @click="mark(replyTo ? 3 : 2)"
      >
        {{ t("save") }}
      </button>
    </div></Dialog
  >
  <Dialog v-if="rename" :title="t('rename')" @close="rename = false"
    ><input
      v-model="title"
      :aria-label="t('title')"
      maxlength="500"
      @keydown.enter="saveRename"
    />
    <div class="actions">
      <button class="primary" @click="saveRename">{{ t("save") }}</button>
    </div></Dialog
  >
  <Dialog v-if="tagging" :title="t('tags')" @close="tagging = false"
    ><div class="tag-options">
      <label v-for="tag in store.snapshot?.tags" :key="tag.id"
        ><input v-model="tagIds" type="checkbox" :value="tag.id" />{{
          tag.name
        }}</label
      >
    </div>
    <input
      v-model="newTag"
      :placeholder="t('newTag')"
      :aria-label="t('newTag')"
      maxlength="80"
    />
    <div class="actions">
      <button class="primary" @click="saveTags().catch(store.fail)">
        {{ t("save") }}
      </button>
    </div></Dialog
  >
  <Dialog
    v-if="aiKind"
    :title="t(aiKind)"
    @close="closeAi"
    ><div v-if="aiKind === 'outline' && aiText" class="ai-output ai-outline">
      <template v-for="(row, index) in outline" :key="index"
        ><button v-if="row.anchor" @click="anchor(row.anchor)">
          {{ row.text }}
        </button>
        <p v-else>{{ row.text }}</p></template
      >
    </div>
    <div v-else class="ai-output" :aria-busy="aiBusy">
      {{ aiText || t(aiBusy ? "loading" : "noEntries") }}
    </div>
    <ul v-if="takeaways.length">
      <li v-for="item in takeaways" :key="item">{{ item }}</li>
    </ul>
    <p v-if="aiError" class="error" role="alert">{{ aiError }}</p>
    <div class="actions">
      <button @click="runAi(aiKind!, true)">{{ t("retry") }}</button
      ><button @click="closeAi">
        {{ t("close") }}
      </button>
    </div></Dialog
  >
  <Dialog v-if="gallery" :title="t('gallery')" @close="gallery = false"
    ><img class="gallery-image" :src="image" :alt="t('gallery')" />
    <div class="actions">
      <button v-for="(url, index) in images" :key="url" @click="image = url">
        {{ index + 1 }}
      </button>
    </div></Dialog
  >
  <Dialog v-if="sharing" :title="t('share')" @close="sharing = false"
    ><label class="share-toggle"
      ><input v-model="shareEnabled" type="checkbox" />{{
        t("shareEnable")
      }}</label
    ><label class="share-toggle"
      ><input v-model="shareLine" type="checkbox" />{{
        t("shareAnnotations")
      }}</label
    ><label class="share-toggle"
      ><input v-model="shareProfile" type="checkbox" />{{
        t("shareProfile")
      }}</label
    ><input
      v-if="shareUrl"
      :value="shareUrl"
      readonly
      :aria-label="t('share')"
    />
    <div class="actions">
      <button
        v-if="shareUrl"
        @click="
          doc &&
          ipc
            .copy(store.auth.generation, doc.handle, shareUrl)
            .catch(store.fail)
        "
      >
        {{ t("shareCopy") }}</button
      ><button class="primary" @click="saveShare">{{ t("save") }}</button>
    </div></Dialog
  >
</template>
<style scoped>
.reader-pane {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--desktop-reader);
  color: var(--desktop-reader-text);
}
.reader-pane > .toolbar {
  color: var(--desktop-text);
  background: var(--desktop-surface);
}
.accent {
  color: var(--desktop-accent);
}
.reader-empty {
  max-width: 440px;
  margin: auto;
  padding: 40px 32px;
}
.reader-glyph {
  width: 76px;
  height: 76px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--desktop-accent-soft);
  border: 1px solid var(--desktop-accent-line);
  color: var(--desktop-accent);
  margin-bottom: 10px;
  box-shadow: 0 18px 50px rgba(120, 55, 32, 0.12);
}
.reader-empty h2 {
  color: var(--desktop-reader-text);
  font-size: 26px;
  letter-spacing: -0.6px;
}
.reader-empty p {
  font-size: 13px;
  line-height: 1.75;
  color: var(--desktop-reader-muted);
}
.reader-hint {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--desktop-reader-faint);
}
.reader-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--desktop-reader);
}
.article-frame {
  display: block;
  border: 0;
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 100%;
  background: var(--desktop-reader);
  opacity: 0;
  transition: opacity 160ms ease-out;
}
.article-frame.ready {
  opacity: 1;
}
.article-frame.ready.stale {
  opacity: 0.55;
  pointer-events: none;
}
.notes-pane {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  width: min(340px, 92%);
  box-shadow: -20px 0 60px rgba(46, 35, 21, 0.12);
  flex-shrink: 0;
  overflow: auto;
  border-left: 1px solid var(--desktop-border);
  padding: 18px 16px 28px;
  color: var(--desktop-text);
  background: var(--desktop-surface);
}
.notes-pane h3 {
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.notes-pane h3 span {
  color: var(--desktop-muted);
  font-weight: 400;
  background: var(--desktop-hover);
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 10.5px;
}
.notes-pane h3 .icon-button {
  margin-left: auto;
}
.notes-pane .empty {
  min-height: 220px;
  padding: 16px;
  font-size: 12px;
}
.annotation {
  padding: 12px 14px;
  border: 1px solid var(--desktop-border);
  border-radius: 10px;
  margin: 0 0 10px;
  background: var(--desktop-raised);
  user-select: text;
  line-height: 1.65;
}
.annotation p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.annotation blockquote,
.selected-quote {
  margin: 0 0 10px;
  padding: 2px 0 2px 12px;
  border-left: 2px solid var(--desktop-accent);
  font-size: 12px;
  max-height: 150px;
  overflow: auto;
  color: var(--desktop-muted);
}
.note-actions {
  display: flex;
  justify-content: flex-end;
  gap: 5px;
  margin-top: 8px;
  font-size: 10px;
}
.note-actions button {
  font-size: 10.5px;
  padding: 3px 6px;
}
.note-add {
  width: 100%;
  margin-top: 12px;
  border: 1px dashed var(--desktop-border-strong);
  color: var(--desktop-muted);
  border-radius: 8px;
}
.note-add:hover:not(:disabled) {
  border-color: var(--desktop-accent-line);
  color: var(--desktop-accent);
  background: var(--desktop-accent-soft);
}
.selection-tools {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--desktop-border);
  border-radius: 12px;
  background: var(--desktop-raised);
  box-shadow: var(--desktop-shadow-float);
  color: var(--desktop-text);
  white-space: nowrap;
}
.selection-tools button {
  font-size: 12px;
  height: 30px;
}
.reader-more {
  position: absolute;
  right: 12px;
  top: 64px;
  z-index: 5;
  background: var(--desktop-raised);
  color: var(--desktop-text);
  padding: 6px;
  width: 190px;
  display: grid;
  border: 1px solid var(--desktop-border);
  border-radius: 12px;
  box-shadow: var(--desktop-shadow-float);
}
.reader-more button {
  justify-content: flex-start;
  padding: 8px 10px;
  font-size: 12px;
}
.tag-options {
  max-height: 240px;
  overflow: auto;
  display: grid;
  gap: 8px;
}
.tag-options label,
.share-toggle {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 12.5px;
}
.ai-output {
  white-space: pre-wrap;
  line-height: 1.8;
  max-height: 55vh;
  overflow: auto;
  user-select: text;
}
.ai-outline {
  display: grid;
  gap: 6px;
}
.ai-outline button {
  text-align: left;
  justify-content: flex-start;
  color: var(--desktop-accent);
}
.gallery-image {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
  border-radius: 8px;
}
</style>

<style scoped>
.processing-state {
  padding: 52px clamp(28px, 7vw, 72px) 80px;
  overflow: auto;
  flex: 1;
}
.processing-state h1 {
  font: 600 clamp(26px, 3.6vw, 36px) / 1.3 var(--desktop-serif);
  letter-spacing: -0.8px;
  margin: 14px 0 34px;
  overflow-wrap: anywhere;
  user-select: text;
}
.source-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--desktop-reader-muted);
  font-size: 11px;
  letter-spacing: 0.02em;
}
.source-label::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--desktop-accent);
}
.processing-card {
  border: 1px solid var(--desktop-reader-border);
  border-radius: 16px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: flex-start;
  background: var(--desktop-reader-surface);
  box-shadow: var(--desktop-shadow-card);
  max-width: 620px;
}
.processing-card > svg {
  color: var(--desktop-accent);
}
.processing-card h2 {
  font-size: 17px;
  font-weight: 600;
}
.processing-card p {
  font-size: 13px;
  line-height: 1.8;
  color: var(--desktop-reader-muted);
}
.processing-card button {
  color: var(--desktop-accent);
  border: 1px solid var(--desktop-reader-border);
  border-radius: 8px;
  background: var(--desktop-reader);
}
.outline-button {
  height: 29px;
  padding: 0 10px;
  font-size: 11.5px;
  color: var(--desktop-muted);
  border: 1px solid var(--desktop-border);
  background: var(--desktop-raised);
  border-radius: 8px;
  box-shadow: var(--desktop-shadow-soft);
}
.outline-button:hover:not(:disabled) {
  color: var(--desktop-accent);
  border-color: var(--desktop-accent-line);
  background: var(--desktop-accent-soft);
}
.reader-empty {
  color: var(--desktop-reader-muted);
}
</style>

<style scoped>
.reader-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 10px 22px;
  border-bottom: 1px solid var(--desktop-reader-border);
  background: var(--desktop-reader);
}
.reader-tags button {
  min-height: 26px;
  padding: 3px 9px;
  border: 1px solid var(--desktop-reader-border);
  border-radius: 6px;
  color: var(--desktop-reader-muted);
  font-size: 11px;
  background: var(--desktop-reader-surface);
}
.reader-tags button:hover:not(:disabled) {
  color: var(--desktop-accent);
  border-color: var(--desktop-accent-line);
}
.reader-tags .edit-tags {
  border-color: transparent;
  background: transparent;
}
</style>
