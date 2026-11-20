<template><span v-if="false" /></template>

<script setup lang="ts">
import { onMounted } from 'vue'

// Renderless: owns the local-first queries of a snapshot detail document whose database became ready after setup.
import { useLocalBookmarks } from '@/composables/bookmark/useLocalBookmarks'
import { useLocalMarks } from '@/composables/bookmark/useLocalMarks'
import { providePowerSync } from '@powersync/vue'
import type { PowerSyncDatabase } from '@powersync/web'

export type SnapshotLocalSources = {
  local: ReturnType<typeof useLocalBookmarks>
  marksQuery: ReturnType<ReturnType<typeof useLocalMarks>['watchMarkDetail']>
  row: ReturnType<ReturnType<typeof useLocalBookmarks>['watchDetail']>
  database: PowerSyncDatabase
}

const props = defineProps<{ database: PowerSyncDatabase; bookmarkUuid: string }>()
const emit = defineEmits<{ ready: [sources: SnapshotLocalSources] }>()

// useQuery resolves its client by injection; the app-level client is not the one this document received late.
providePowerSync(props.database)
const local = useLocalBookmarks(props.database)
const sources: SnapshotLocalSources = {
  local,
  marksQuery: useLocalMarks(props.database).watchMarkDetail(props.bookmarkUuid),
  row: local.watchDetail(props.bookmarkUuid),
  database: props.database
}
// Emit after setup so the parent never mutates its state while this component is being created.
onMounted(() => emit('ready', sources))
</script>
