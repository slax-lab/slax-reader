<template>
  <Transition name="dismiss" @enter="handleEnter" @afterLeave="handleLeave">
    <div class="image-preview" v-show="showPreview" @click="clickBackground">
      <img
        ref="imageElement"
        :class="{
          'opacity-0': imageHidden,
          wider: imageFrame.imgWidth > imageFrame.imgHeight,
          higher: imageFrame.imgHeight > imageFrame.imgWidth,
          large: isLargeImage
        }"
        :src="url"
        class="image"
        @click.stop="clickImage"
      />
      <img ref="placeholderImageElement" :src="url" :class="{ hidden: placeholderHidden }" class="placholder" />
    </div>
  </Transition>
</template>

<script lang="ts" setup>
import { ref } from 'vue'

export interface ImagePreviewFrame {
  left: number
  top: number
  width: number
  height: number
  imgWidth: number
  imgHeight: number
}

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  url: {
    type: String,
    required: true,
    default: null
  },
  imageFrame: {
    type: Object as PropType<ImagePreviewFrame>,
    required: false,
    default: null
  }
})

const emits = defineEmits(['appear', 'dismiss'])

const dismissEnable = ref(false)
const imageHidden = ref(true)
const placeholderHidden = ref(false)
const showPreview = ref(false)
const imageElement = ref<HTMLImageElement>()
const placeholderImageElement = ref<HTMLImageElement>()
const isLargeImage = computed(() => {
  if (props.imageFrame.imgWidth > props.imageFrame.imgHeight) {
    return props.imageFrame.height > 0 ? props.imageFrame.imgWidth / props.imageFrame.height > 3 : false
  } else if (props.imageFrame.imgHeight > props.imageFrame.imgWidth) {
    return props.imageFrame.width > 0 ? props.imageFrame.imgHeight / props.imageFrame.width > 3 : false
  }

  return false
})

onMounted(() => {
  emits('appear')
  showPreview.value = true
})

const performPlaceholderAppear = (opacity = 1) => {
  if (!placeholderImageElement.value || !imageElement.value) {
    return
  }

  const image = imageElement.value
  const placeholderImage = placeholderImageElement.value

  const frame = props.imageFrame
  Object.assign(placeholderImage.style, {
    top: `${frame.top}px`,
    left: `${frame.left}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
    opacity: `${opacity}`
  })

  setTimeout(() => {
    const targetFrame = image.getBoundingClientRect()
    if (!targetFrame) {
      return
    }

    const targetHeight = (frame.imgHeight / frame.imgWidth) * targetFrame.width || (frame.height / frame.width) * targetFrame.width
    Object.assign(placeholderImage.style, {
      top: `${targetFrame.top}px`,
      left: `${targetFrame.left}px`,
      width: `${targetFrame.width}px`,
      height: `${targetHeight}px`
    })
  }, 100)

  setTimeout(() => {
    imageHidden.value = false
    placeholderHidden.value = true
    dismissEnable.value = true
  }, 250)
}

const resetPlaceholder = () => {
  const placeholderImage = placeholderImageElement.value
  if (!placeholderImage) {
    return
  }

  imageHidden.value = true
  placeholderHidden.value = false

  const frame = props.imageFrame
  console.log(frame)
  setTimeout(() => {
    const placeholderFrame = placeholderImage?.getBoundingClientRect()
    if (!placeholderFrame || !(placeholderFrame.width * placeholderFrame.height)) {
      showPreview.value = false
    } else {
      Object.assign(placeholderImage.style, {
        top: `${frame.top}px`,
        left: `${frame.left}px`,
        width: `${frame.width}px`,
        height: `${frame.height}px`,
        opacity: `1`
      })
    }
  }, 0)

  setTimeout(() => {
    showPreview.value && (showPreview.value = false)
  }, 250)
}

const handleEnter = () => {
  if (!imageElement.value) {
    return
  }

  if (!checkImageFrameAvailable()) {
    imageHidden.value = false
    placeholderHidden.value = true
    dismissEnable.value = true
  } else {
    performPlaceholderAppear(1)
  }
}

const checkImageFrameAvailable = () => {
  const frame = props.imageFrame
  if (!frame) {
    return false
  }

  const value = frame.imgWidth * frame.imgHeight * frame.width * frame.height
  if (!value) {
    return false
  }

  return true
}

const clickImage = () => {}

const clickBackground = () => {
  if (!placeholderHidden.value || !dismissEnable.value) {
    return
  }

  if (!checkImageFrameAvailable()) {
    showPreview.value = false
  } else {
    resetPlaceholder()
    setTimeout(() => {
      showPreview.value = false
    }, 250)
  }
}

const handleLeave = () => {
  emits('dismiss')
}
</script>

<style lang="scss" scoped>
.image-preview {
  --style: fixed inset-0 bg-black bg-opacity-80 p-15px overflow-scroll z-200 flex;

  & > * {
    --style: select-none;
  }

  &:has(.large) {
    --style: p-70px;
  }

  &:not(:has(.large)) {
    --style: justify-center items-center;
  }

  &:has(.large):has(.wider) {
    --style: justify-start items-center;
  }

  &:has(.large):has(.higher) {
    --style: justify-center items-start;
  }

  .image {
    --style: z-10 object-contain bg-surface;
    object-fit: contain;

    &.wider {
      max-height: 100%;
      &:not(.large) {
        max-width: 90%;
      }
    }

    &.higher {
      max-width: 90%;
      &:not(.large) {
        max-height: 90vh;
      }
    }
  }

  .placholder {
    --style: absolute z-0 object-contain transition-all duration-normal bg-surface;
  }
}

.dismiss-enter-from {
  background-color: transparent;
}

.dismiss-enter-active {
  transition: background-color var(--slax-dur-normal) ease-in-out;
}

.dismiss-leave-to {
  opacity: 0;
}

.dismiss-leave-active {
  transition: opacity var(--slax-dur-normal) ease-in-out;
}
</style>
