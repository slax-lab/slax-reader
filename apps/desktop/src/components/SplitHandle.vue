<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
const props = defineProps<{
  modelValue: number;
  min: number;
  max: number;
  label: string;
  reset: number;
  property: string;
  target?: HTMLElement | null;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: number];
  finish: [];
}>();
const dragging = ref(false),
  live = ref<number | null>(null);
let start = 0,
  initial = 0,
  pointer = -1,
  frame = 0,
  pending: number | null = null,
  timer: ReturnType<typeof setTimeout> | undefined;
const clamp = (value: number) =>
  Math.round(Math.max(props.min, Math.min(props.max, value)));
function apply(value: number) {
  live.value = value;
  props.target?.style.setProperty(props.property, `${value}px`);
}
function flush() {
  cancelAnimationFrame(frame);
  frame = 0;
  if (pending !== null) apply(pending);
  pending = null;
}
function commit() {
  clearTimeout(timer);
  timer = undefined;
  if (live.value === null) return;
  emit("update:modelValue", live.value);
  props.target?.style.removeProperty(props.property);
  live.value = null;
  emit("finish");
}
function down(event: PointerEvent) {
  if (event.button !== 0 || dragging.value) return;
  event.preventDefault();
  initial = live.value ?? props.modelValue;
  commit();
  start = event.clientX;
  pointer = event.pointerId;
  dragging.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  document.documentElement.classList.add("resizing-columns");
}
function move(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== pointer) return;
  pending = clamp(initial + event.clientX - start);
  if (!frame) frame = requestAnimationFrame(flush);
}
function finish(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== pointer) return;
  dragging.value = false;
  pointer = -1;
  document.documentElement.classList.remove("resizing-columns");
  flush();
  commit();
}
function key(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  apply(
    clamp(
      event.key === "Home"
        ? props.min
        : event.key === "End"
          ? props.max
          : (live.value ?? props.modelValue) +
            (event.key === "ArrowLeft" ? -16 : 16),
    ),
  );
  clearTimeout(timer);
  timer = setTimeout(commit, 300);
}
function restore() {
  apply(clamp(props.reset));
  commit();
}
onBeforeUnmount(() => {
  if (dragging.value)
    document.documentElement.classList.remove("resizing-columns");
  dragging.value = false;
  flush();
  commit();
});
</script>
<template>
  <div
    class="split-handle"
    :class="{ dragging }"
    role="separator"
    aria-orientation="vertical"
    tabindex="0"
    :aria-label="label"
    :aria-valuenow="live ?? modelValue"
    :aria-valuemin="min"
    :aria-valuemax="max"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="finish"
    @pointercancel="finish"
    @lostpointercapture="finish"
    @keydown="key"
    @dblclick="restore"
  />
</template>
<style scoped>
.split-handle {
  position: relative;
  width: 1px;
  flex: 0 0 1px;
  background: var(--desktop-border);
  z-index: 8;
  cursor: col-resize;
  touch-action: none;
}
.split-handle::after {
  content: "";
  position: absolute;
  inset: 0 -4px;
}
.split-handle::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 3px;
  height: 34px;
  margin: -17px 0 0 -1.5px;
  border-radius: 2px;
  background: transparent;
  transition: background-color 140ms ease;
}
.split-handle:hover,
.split-handle.dragging,
.split-handle:focus-visible {
  outline: none;
  background: var(--desktop-accent-line);
}
.split-handle:hover::before,
.split-handle.dragging::before,
.split-handle:focus-visible::before {
  background: var(--desktop-accent);
}
</style>
