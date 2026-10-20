<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import Icon from "./Icon.vue";
defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();
const root = ref<HTMLDialogElement>();
const previous = document.activeElement as HTMLElement | null;
let mounted = false;
function cancel(event: Event) {
  event.preventDefault();
  emit("close");
}
function closed() {
  if (mounted) emit("close");
}
function keys(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const nodes = [
    ...(root.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input, textarea, select, a[href], [tabindex="0"]',
    ) ?? []),
  ];
  const first = nodes[0],
    last = nodes.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
onMounted(() => {
  mounted = true;
  if (!root.value?.open) root.value?.showModal();
  root.value?.querySelector<HTMLElement>("input, textarea, button")?.focus();
});
onBeforeUnmount(() => {
  mounted = false;
  if (root.value?.open) root.value.close();
  if (previous?.isConnected) previous.focus();
});
</script>
<template>
  <dialog
    ref="root"
    class="overlay"
    :aria-label="title"
    @cancel="cancel"
    @close="closed"
    @keydown="keys"
    @mousedown.self="emit('close')"
  >
    <section class="dialog">
      <div class="dialog-heading">
        <h2>{{ title }}</h2>
        <button class="icon-button" aria-label="Close" @click="emit('close')">
          <Icon name="close" />
        </button>
      </div>
      <slot />
    </section>
  </dialog>
</template>
<style scoped>
.dialog-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.dialog-heading h2 {
  margin: 0;
}
.dialog-heading .icon-button {
  color: var(--desktop-muted);
}
.dialog-heading .icon-button:hover:not(:disabled) {
  color: var(--desktop-text);
  background: var(--desktop-hover);
}
</style>
