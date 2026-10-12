<template>
  <div class="user-page-skeleton">
    <div class="skeleton-options">
      <div class="skeleton-option">
        <div class="skeleton skeleton-label"></div>
        <div class="skeleton skeleton-bar"></div>
      </div>
      <div class="skeleton-option">
        <div class="skeleton skeleton-label"></div>
        <div class="skeleton skeleton-bar"></div>
      </div>
    </div>
    <div class="skeleton-section">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton-personal">
        <div class="skeleton skeleton-avatar"></div>
        <div class="skeleton-text">
          <div class="skeleton skeleton-username"></div>
          <div class="skeleton skeleton-email"></div>
        </div>
      </div>
    </div>
    <div class="skeleton-section">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-content"></div>
    </div>
    <div class="skeleton-section">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-button"></div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.user-page-skeleton {
  --style: w-full;

  .skeleton {
    background: var(--slax-border);
    --style: rounded-8px animate-pulse;
  }

  .skeleton-options {
    --style: mt-24px flex gap-48px;

    .skeleton-option {
      --style: flex items-center gap-16px;

      .skeleton-label {
        --style: w-80px h-20px;
      }

      .skeleton-bar {
        --style: w-180px h-32px;
      }
    }
  }

  .skeleton-section {
    --style: mt-60px;

    .skeleton-title {
      --style: w-200px h-33px;
    }

    .skeleton-personal {
      --style: mt-40px flex items-center gap-24px;

      .skeleton-avatar {
        --style: w-64px h-64px rounded-8px flex-shrink-0;
      }

      .skeleton-text {
        --style: flex flex-col gap-8px flex-1;

        .skeleton-username {
          --style: w-160px h-25px;
        }

        .skeleton-email {
          --style: w-200px h-20px;
        }
      }
    }

    .skeleton-content {
      --style: mt-24px w-full h-80px;
    }

    .skeleton-button {
      --style: mt-24px w-full h-48px;
    }
  }
}
</style>
