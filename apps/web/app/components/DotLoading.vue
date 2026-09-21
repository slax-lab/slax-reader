<template>
  <div>
    <div class="dot-loading">
      <div class="dot" :style="indicateColor ? { 'background-color': indicateColor } : {}" v-for="(_, index) in Array.from({ length: 4 })" :key="index"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps({
  indicateColor: {
    type: String,
    required: false,
    default: ''
  }
})
</script>

<style lang="scss" scoped>
$duration: 1.5s;

.dot-loading {
  user-select: none;
  display: flex;
  align-items: center;

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    &:not(:first-child) {
      margin-left: 5px;
    }

    &:nth-child(1) {
      background-color: #e15b64;
      animation: scale1 $duration linear infinite;
    }

    &:nth-child(2) {
      background-color: #f8b26a;
      animation: scale2 $duration linear infinite;
    }

    &:nth-child(3) {
      background-color: #abbd81;
      animation: scale3 $duration linear infinite;
    }

    &:nth-child(4) {
      background-color: #81a3bd;
      animation: scale4 $duration linear infinite;
    }
  }

  @keyframes scale1 {
    0% {
      transform: scale(0.4);
    }

    20% {
      transform: scale(0);
    }

    65% {
      transform: scale(1);
    }

    75% {
      transform: scale(1);
    }

    100% {
      transform: scale(0.4);
    }
  }

  @keyframes scale2 {
    0% {
      transform: scale(0.6);
    }

    30% {
      transform: scale(0);
    }

    75% {
      transform: scale(1);
    }

    85% {
      transform: scale(1);
    }

    100% {
      transform: scale(0.6);
    }
  }

  @keyframes scale3 {
    0% {
      transform: scale(0.8);
    }

    40% {
      transform: scale(0);
    }

    85% {
      transform: scale(1);
    }

    95% {
      transform: scale(1);
    }

    100% {
      transform: scale(0.8);
    }
  }

  @keyframes scale4 {
    5% {
      transform: scale(1);
    }

    50% {
      transform: scale(0);
    }

    95% {
      transform: scale(1);
    }
  }
}
</style>
