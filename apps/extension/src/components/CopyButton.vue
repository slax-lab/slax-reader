<template>
  <div class="copy-button">
    <div class="icon">
      <svg v-html="buttonSvg"></svg>
    </div>
    <span>{{ $t('component.copy_button.copy_content') }}</span>
  </div>
</template>

<script setup lang="ts">
const buttonSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><g fill="none" fill-rule="evenodd" stroke="#DBDFE8" stroke-width="2"><rect width="13" height="13" x="3" y="8" rx="2"/><path stroke-linecap="round" d="M8 4.857C8 3.831 8.831 3 9.857 3h9.286C20.169 3 21 3.831 21 4.857v9.286A1.857 1.857 0 0 1 19.143 16"/></g></svg>`
</script>

<style lang="scss" scoped>
.copy-button {
  user-select: none;
  background: linear-gradient(180deg, #0b0a23 0%, #17294e 100%);
  box-shadow: 0px 10px 20px 0px rgba(0, 0, 0, 0.08);
  padding: 0px 8px;
  display: flex;
  align-items: center;
  overflow: hidden;
  flex-wrap: nowrap;
  white-space: nowrap;
  transition: all 0.25s ease-in-out;
  height: 40px;
  border-radius: 20px;
  cursor: pointer;
  max-width: 40px;

  .icon {
    height: 40px;
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: transform 0.25s ease-in-out;

    svg {
      position: relative;
      width: 24px;
      height: 24px;
      transition: transform 0.25s ease-in-out;
    }
  }

  span {
    opacity: 0;
    margin-left: 12px;
    padding-right: 12px;
    font-family:
      PingFangSC,
      PingFang SC;
    font-weight: 400;
    font-size: 14px;
    color: #dbdfe8;
    line-height: 20px;
    text-align: right;
    font-style: normal;
    transition: opacity 0.15s ease-in-out;
  }

  &:hover {
    max-width: 1000px;
    background: linear-gradient(180deg, #0b0a23 0%, #17294e 100%);

    .icon {
      transform: scale(1.1);
      svg {
        transform: translateX(2px);
      }
    }

    span {
      opacity: 1;
    }
  }

  &:active {
    transform: scale(1.05);
  }
}
</style>
