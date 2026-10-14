<template>
  <div>
    <div class="dot-loading">
      <div class="dot" v-for="(_, index) in Array.from({ length: 3 })" :key="index"></div>
    </div>
  </div>
</template>

<script setup lang="ts"></script>

<style lang="scss" scoped>
.dot-loading {
  user-select: none;
  display: flex;
  align-items: center;

  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    animation: wave 1.4s linear infinite; /* 应用动画 */
    &:not(:first-child) {
      margin-left: 4px;
    }

    &:nth-child(1) {
      background-color: #16b998;
      animation-delay: 0s;
    }

    &:nth-child(2) {
      background-color: #ffc255;
      animation-delay: 0.25s;
    }

    &:nth-child(3) {
      background-color: #56caf2;
      animation-delay: 0.5s;
    }

    &:nth-child(4) {
      background-color: #fb8f6c;
      animation-delay: 0.75s;
    }
  }

  @keyframes wave {
    0%,
    100% {
      transform: translateY(0);
    }
    25% {
      transform: translateY(-60%);
    }
    75% {
      transform: translateY(60%);
    }
  }
}
</style>
