import { computed, getCurrentInstance } from 'vue'

// Chips are interactive when their parent listens for clicks; legacy chips also require opt-in.
export function useTagChipInteraction(opts: { legacy?: boolean; legacyInteractive?: boolean }) {
  const onClickListener = !!getCurrentInstance()?.vnode.props?.onClick
  const isClickable = computed(() => onClickListener && (!opts.legacy || !!opts.legacyInteractive))

  return { isClickable }
}
