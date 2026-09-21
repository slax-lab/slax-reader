<template>
  <div class="bookmark-tags" ref="bookmarkTagsEle">
    <div class="list-container">
      <TransitionGroup name="cell">
        <div class="tag" ref="bookmarkTagCells" v-for="tag in bookmarkTags" :key="tag.key" :class="{ group: !props.readonly }">
          <span> {{ tag.show_name }} </span>
          <button v-if="!props.readonly" class="!group-hover:visible !group-hover:opacity-100" @click="() => !tag.loading && deleteBookmarkTag(tag.id)">
            <i class="seperator"></i>
            <img v-if="!tag.loading" src="@/assets/tiny-cross-gold-icon.png" alt="" />
            <div v-else class="i-svg-spinners:90-ring size-14px color-#f4c982"></div>
          </button>
        </div>
      </TransitionGroup>
      <div class="loading" v-if="isTagLoading">
        <div class="i-svg-spinners:90-ring w-24px color-#f4c982"></div>
      </div>
      <div class="operate" v-if="!props.readonly">
        <button ref="add" class="add" @click="addingTagClick">
          <img src="@/assets/tiny-plus-icon.png" alt="" />
        </button>
        <span class="text-placeholder" v-if="bookmarkTags.length === 0" @click="addingTagClick"> {{ $t('component.bookmark_tags.add') }} </span>
        <Transition name="opacity">
          <div class="search-list" ref="searchList" v-show="isAddingTag" v-on-click-outside="tagClickoutside">
            <div class="search-wrapper" :class="{ focus: isFocus }">
              <img src="@/assets/tiny-search-outline-icon.png" alt="" />
              <input
                ref="textarea"
                type="text"
                :placeholder="$t('component.bookmark_tags.placeholder')"
                @focus="isFocus = true"
                @blur="isFocus = false"
                @compositionstart="compositionAppear = true"
                @compositionend="compositionAppear = false"
                v-model="searchText"
                v-on-key-stroke:Enter="[onKeyDown, { eventName: 'keydown' }]"
              />
            </div>
            <div class="search-result" v-if="searchResultTags.length > 0">
              <div class="result-wrapper">
                <TransitionGroup name="opacity">
                  <div class="search-tag" :class="{ 'ai-style': true }" v-for="tag in searchResultTags" :key="tag.key" @click="searchTagClick(tag)">
                    <img class="tag-icon" src="@/assets/tiny-tags-outline-icon.png" alt="" />
                    <img class="tag-icon highlighted" src="@/assets/tiny-tags-outline-highlighted-icon.png" alt="" />
                    <span>{{ tag.show_name }}</span>
                    <i class="ai" v-if="tag.system"></i>
                  </div>
                </TransitionGroup>
              </div>
            </div>
            <div class="create-wrapper" v-if="searchText.length > 0">
              <div class="search-tag highlighted" @click="addLocalTag">
                <img class="tag-icon" src="@/assets/tiny-tags-outline-highlighted-icon.png" alt="" />
                <span>{{ $t('component.bookmark_tags.add_placeholder', [searchText]) }}</span>
              </div>
            </div>
            <div class="list-loading" v-if="isAddingLoading">
              <div class="i-svg-spinners:90-ring w-24px color-#f4c982"></div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { RESTMethodPath } from '@commons/types/const'
import type { BookmarkTag } from '@commons/types/interface'
import { vOnClickOutside, vOnKeyStroke } from '@vueuse/components'

interface BookmarkTagItem extends BookmarkTag {
  loading: boolean
  key: string
}

const props = defineProps({
  bookmarkId: {
    type: Number,
    required: false
  },
  tags: {
    type: Array as PropType<BookmarkTag[]>,
    required: true
  },
  readonly: {
    type: Boolean,
    required: false
  }
})

const tagWrapper = (tag: BookmarkTag) => {
  return {
    ...tag,
    loading: false,
    key: `${tag.id}_${tag.show_name}`
  }
}

const minGap = ref<{ x: number; y: number }>({ x: 48, y: 0 })
const bookmarkTagsEle = ref<HTMLDivElement>()
const add = ref<HTMLButtonElement>()
const searchList = ref<HTMLDivElement>()
const textarea = ref<HTMLTextAreaElement>()

const bookmarkTags = ref<BookmarkTagItem[]>(props.tags.map(tagWrapper))
const searchTags = ref<BookmarkTagItem[]>([])

const isFocus = ref(false)
const compositionAppear = ref(false)
const isTagLoading = ref(false)
const isAddingLoading = ref(false)
const isAddingTag = ref(false)
const searchText = ref('')
const currentBookmarkTagKeys = computed(() => bookmarkTags.value.map(tag => tag.key).filter(key => !!key) || [])
const bookmarkTagCells = ref<HTMLDivElement[]>([])

const filteredSearchTags = computed(() => {
  const filters = [...searchTags.value].filter(tag => currentBookmarkTagKeys.value.indexOf(tag.key) === -1)
  return filters
})

const searchResultTags = computed(() => {
  if (!searchText.value) {
    return filteredSearchTags.value
  }

  return filteredSearchTags.value.filter(tag => tag.show_name.includes(searchText.value))
})

watch(
  () => props.tags,
  newTags => {
    bookmarkTags.value = tagsHandler(newTags)
  },
  { deep: true }
)

watch(
  () => isAddingTag.value,
  value => {
    if (value) {
      const eleRect = bookmarkTagsEle.value?.getBoundingClientRect()
      const rect = add.value?.getBoundingClientRect()

      if (eleRect && rect && searchList.value) {
        const { x, y } = minGap.value
        const xGap = Math.abs(x)
        const yGap = Math.abs(y)
        const yOffset = rect.bottom - eleRect.top + 10
        const xOffset = Math.min(rect.left - eleRect.left, eleRect.width - 200 - xGap)

        searchList.value.style.top = `${yOffset}px`
        searchList.value.style.left = `${xOffset}px`
      }

      searchingTags()
    } else {
      searchText.value = ''
    }
  }
)

const searchingTags = async () => {
  if (isAddingLoading.value) {
    return
  }

  isAddingLoading.value = true
  const res = await request.get<BookmarkTag[]>({
    url: RESTMethodPath.TAG_LIST
  })

  if (res) {
    searchTags.value = res.map(tagWrapper)
  }

  isAddingLoading.value = false
}

const addingBookmarkTags = (params: { tagName?: string; tagId?: number }[]) => {
  if (!props.bookmarkId || !params.length) {
    return
  }

  const filterLoadingTags = params.filter(item => {
    return !bookmarkTags.value.find(tag => tag.show_name === item.tagName)
  })

  if (filterLoadingTags.length === 0) {
    return
  }

  bookmarkTags.value.push(
    ...filterLoadingTags.map(item => ({ ...tagWrapper({ id: item.tagId || 0, name: item.tagName || '', show_name: item.tagName || '', system: false }), loading: true }))
  )

  requestAddingBookmarkTags(params)
    .then(res => {
      bookmarkTags.value = bookmarkTags.value.map(tag => {
        const newTag = res.find(t => t.show_name === tag.show_name)
        return newTag ? tagWrapper(newTag) : tag
      })
    })
    .catch(err => {
      bookmarkTags.value = bookmarkTags.value.filter(tag => !filterLoadingTags.find(t => t.tagName === tag.show_name))
    })
}

const requestAddingBookmarkTags = async (params: { tagName?: string; tagId?: number }[]) => {
  try {
    const res = await request.post<BookmarkTag[]>({
      url: RESTMethodPath.ADD_BOOKMARK_TAGS,
      body: {
        bookmark_id: props.bookmarkId,
        tags: params.map(tag => ({
          name: tag.tagName,
          id: tag.tagId
        }))
      }
    })

    if (!res) {
      throw new Error(res)
    }

    return res
  } catch (error) {
    console.error(error)
    throw error
  }
}

const deleteBookmarkTag = async (tagId: number) => {
  if (!props.bookmarkId) {
    return
  }

  const index = bookmarkTags.value.findIndex(tag => tag.id === tagId)
  const tag = bookmarkTags.value[index]

  tag.loading = true
  await request.post<{ ok: boolean }>({
    url: RESTMethodPath.DELETE_BOOKMARK_TAG,
    body: {
      bookmark_id: props.bookmarkId,
      tag_id: tagId
    }
  })

  tag.loading = false
  if (index > -1) {
    bookmarkTags.value.splice(index, 1)
  }
}

const onKeyDown = async (e: KeyboardEvent) => {
  if (e.key !== 'Enter' || !isAddingTag.value || !searchText.value) {
    return
  }

  addLocalTag()
}

const addLocalTag = async () => {
  const text = searchText.value
  const findTag = bookmarkTags.value.find(tag => tag.show_name === text)
  if (findTag) {
    highlightTagCell(bookmarkTags.value.indexOf(findTag))
    return
  }

  const findSearchTag = searchTags.value.find(tag => tag.show_name === text)
  addingBookmarkTags([
    {
      tagName: text,
      tagId: findSearchTag?.id
    }
  ])

  searchText.value = ''
  isAddingTag.value = false
}

const highlightTagCell = (index: number) => {
  if (index < 0 || bookmarkTagCells.value.length <= index) {
    return
  }

  const cell = bookmarkTagCells.value[index]

  const highlightingKey = 'highlighting'
  cell.classList.add(highlightingKey)

  setTimeout(() => {
    cell.classList.remove(highlightingKey)
  }, 1000)
}

const tagClickoutside = async () => {
  isAddingTag.value = false
}

const searchTagClick = async (tag: BookmarkTag) => {
  addingBookmarkTags([
    {
      tagName: tag.show_name,
      tagId: tag.id
    }
  ])
}

const addingTagClick = (e: MouseEvent) => {
  e.stopPropagation()
  isAddingTag.value = !isAddingTag.value

  if (searchResultTags.value.length === 0) {
    focusTextinput()
  }
}

const focusTextinput = () => {
  nextTick(() => {
    if (textarea.value) {
      textarea.value.blur()
      setTimeout(() => {
        textarea.value?.focus()
      }, 50)
    }
  })
}

const tagsHandler = (tags: BookmarkTag[]) => {
  const loadingRef: Record<string, boolean> = {}
  bookmarkTags.value.forEach(tag => {
    loadingRef[tag.show_name] = tag.loading
  })

  return tags.map(tag => ({
    ...tagWrapper(tag),
    loading: loadingRef[tag.show_name] || false
  }))
}
</script>

<style lang="scss" scoped>
.bookmark-tags {
  --style: relative -mb-10px;

  .list-container {
    --style: w-full flex flex-wrap;

    & > * {
      --style: 'not-last:mr-10px';
    }

    .tag {
      --style: relative flex-center flex-wrap border-(1px solid) rounded-4px h-24px py-2px px-4px transition-all duration-250 mb-10px max-w-250px whitespace-nowrap;
      --style: 'border-#e4d6ba dark:border-#e4d6ba3d';

      // &.group:hover { // 暂时让关闭按钮永久显示
      &.group {
        --style: pr-29px;
      }

      &.highlighting {
        --style: animate-(pulse duration-500);
      }

      span {
        --style: text-(13px #a28d64) line-height-18px text-ellipsis overflow-hidden;
      }

      button {
        --style: 'absolute right-3px top-0 w-16px h-full flex-center hover:scale-105 transition-all duration-250 active:scale-110 opacity-100';
        .seperator {
          --style: absolute -left-3px top-1/2 -translate-y-1/2 w-1px h-10px;
          --style: 'bg-#0f141914 dark:bg-#FFFFFF1F';
        }

        img {
          --style: size-16px object-fit;
        }
      }
    }

    .loading {
      --style: flex-center h-24px;
    }

    .operate {
      // --style: relative;
      --style: flex-center mb-10px;

      button {
        --style: bg-#a28d6414 rounded-4px w-24px h-24px flex-center;
        img {
          --style: w-10px h-10px;
        }
      }

      .text-placeholder {
        --style: ml-8px text-(13px #a28d64) line-height-18px text-ellipsis overflow-hidden cursor-pointer select-none;
      }

      .search-list {
        --style: absolute top-full -mt-2px w-260px rounded-8px overflow-hidden border-(1px solid #a28d643d) shadow-[0px_40px_80px_0px_#00000052] px-12px py-16px z-10 select-none;
        --style: 'bg-#fff dark:(bg-#141414)';

        &:focus {
          --style: border-(1.5px #e4d6ba66) text-#A28D64;
        }

        &:has(.search-tag) {
          --style: pb-0;
        }

        .search-wrapper {
          --style: select-none border-(1px solid) flex items-center rounded-6px h-36px transition-all duration-300;
          --style: ' border-#3333330d dark:(border-#FFFFFF14)';

          &.focus {
            --style: border-(#e4d6ba99);
          }

          img {
            --style: size-16px ml-8px;
          }

          input {
            --style: ml-8px bg-transparent border-none text-(13px) line-height-18px w-full h-full;
            --style: 'text-#999 dark:(text-#A28D64)';

            &:placeholder-shown {
              text-overflow: ellipsis;
            }

            &::placeholder,
            &::-webkit-input-placeholder {
              --style: text-(13px #999999 ellipsis) whitespace-nowrap overflow-hidden line-height-21px w-95%;
            }
          }
        }

        .search-result {
          --style: mt-16px overflow-y-scroll relative;
          &::before,
          &::after {
            --style: z-2 content-empty absolute h-4px w-full left-0 to-transprent;
            --style: 'from-#fff dark:(from-#141414)';
          }

          &::before {
            --style: bottom-0 bg-gradient-to-t;
          }

          &::after {
            --style: top-0 bg-gradient-to-b;
          }
        }

        .result-wrapper,
        .create-wrapper {
          .search-tag {
            --style: border-none rounded-6px p-10px flex items-center justify-between cursor-pointer transition-all duration-250 whitespace-nowrap select-none;
            --style: 'border-#e4d6ba dark:border-#e4d6ba3d';

            .tag-icon {
              --style: size-16px object-contain;

              &.highlighted {
                --style: hidden;
              }
            }

            span {
              --style: ml-12px flex-1 text-(15px #ffffff99) line-height-16px text-ellipsis overflow-hidden transition-colors duration-250;
            }

            &:hover {
              --style: border-#f4c982 bg-#1F1F1F;
              .tag-icon {
                --style: '!hidden';

                &.highlighted {
                  --style: '!inline-block';
                }
              }

              span {
                --style: text-#A28D64;
              }
            }

            &:has(.ai) {
              --style: border-#e4d6ba4d;
              span {
                --style: text-#333333ad;
              }
            }

            &.highlighted {
              .tag-icon {
                --style: '!inline-block';
              }

              span {
                --style: '!text-#A28D64';
              }
            }

            .ai {
              --style: ml-12px bg-contain w-16px h-16px shrink-0;
              background-image: url('@/assets/cell-ai-style-icon.png');
            }
          }
        }

        .result-wrapper {
          --style: max-h-422px py-4px overflow-y-scroll pb-14px;
        }

        .create-wrapper {
          --style: py-4px border-t-(1px solid #ffffff0f);
        }

        .list-loading {
          --style: absolute inset-0 z-3 flex-center bg-transparent;
        }
      }
    }
  }
}

.cell-leave-to,
.cell-enter-from {
  --style: 'opacity-0 !max-w-0 !py-2px !mr-0px';
}

.cell-enter-active,
.cell-leave-active {
  --style: transition-all duration-250 ease-in-out;
}
</style>
