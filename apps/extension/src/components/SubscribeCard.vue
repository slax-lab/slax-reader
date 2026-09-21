<template>
  <div class="subscribe-card">
    <div class="plan highlighted">
      <div class="plan-content">
        <div class="title">
          <img src="@/assets/tiny-diamond.png" alt="" />
          <span>{{ plan.title }}</span>
        </div>
        <div class="price">
          <div class="amount">{{ plan.unit }}{{ plan.price }}</div>
          <div class="period">{{ plan.period }}</div>
          <div class="original" v-if="plan.original">({{ plan.unit }}{{ plan.original }})</div>
        </div>
        <div class="benefits">
          <div :class="{ free: benefitIdx === 0, pro: benefitIdx === 1 }" v-for="(benefit, benefitIdx) in [plan.free, plan.pro]" :key="benefitIdx" v-show="benefit.length > 0">
            <div class="benefit" :class="{ highlighted: benefitIdx === 1 }" v-for="item in benefit" :key="item.name">
              <div class="tick"></div>
              <div class="text">
                <span>{{ item.name }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="operate">
        <div class="rule">
          {{ $t('component.plan_card.subscribe_month_rule') }}
        </div>
        <button class="highlighted" @click="subscribe">
          <span>{{ $t('component.plan_card.one_time_purchase') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
interface PlanItem {
  title: string
  unit: string
  price: number
  oncePrice: number
  period: string
  original?: number
  free: { name: string }[]
  pro: { name: string }[]
}

const plan = ref<PlanItem>({
  title: $t('component.plan_card.plan.title'),
  unit: '$',
  price: 5.99,
  period: $t('component.plan_card.plan.period'),
  original: 9.99,
  oncePrice: 9.99,
  free: [
    {
      name: $t('component.plan_card.plan.free_features.one')
    }
  ],
  pro: [
    {
      name: $t('component.plan_card.plan.pro_features.one')
    },
    {
      name: $t('component.plan_card.plan.pro_features.two')
    },

    {
      name: $t('component.plan_card.plan.pro_features.three')
    },

    {
      name: $t('component.plan_card.plan.pro_features.four')
    },
    {
      name: $t('component.plan_card.plan.pro_features.five')
    }
  ]
})

const subscribe = () => {
  window.open(`${process.env.PUBLIC_BASE_URL}/bookmarks#subscribe`, '_blank')
}
</script>

<style lang="scss" scoped>
.subscribe-card {
  --style: w-full max-w-400px flex justify-center items-stretch;
  --style: 'max-md:(flex-col) md:(flex-row)';

  & > * {
    --style: 'max-md:(not-first:mt-16px) md:(not-first:ml-16px)';
  }

  .plan {
    --style: relative p-32px w-full rounded-16px border-solid flex flex-col items-center justify-between;
    --style: 'bg-#fff border-1px border-#ecf0f5 dark:(bg-#1F1F1FFF border-3px border-#FFFFFF0A)';

    .plan-content {
      --style: w-full flex flex-col items-start;

      .title {
        --style: flex-center select-none py-3px pl-8px pr-12px bg-#333 rounded-(tl-4px bl-4px tr-14px br-2px);
        img {
          --style: w-14px h-13px object-contain;
        }

        span {
          --style: ml-8px text-(14px #ffdcc1ff) line-height-20px font-500;
        }
      }

      .price {
        --style: mt-16px w-full flex items-center;

        .amount {
          --style: font-600 text-(32px ellipsis) line-height-45px flex-shrink-1 overflow-hidden whitespace-nowrap;
          --style: 'text-#0f1419 dark:(text-#FFFFFFE6)';
        }

        .period,
        .original {
          --style: ml-8px -mb-8px font-500 text-(14px) line-height-20px flex-shrink-0;
          --style: 'text-#999999 dark:(text-#FFFFFF66)';
        }

        .original {
          --style: line-through;
        }
      }

      .benefits {
        --style: mt-28px w-full flex flex-col items-start justify-between;

        & > * + div {
          --style: mt-12px;
        }

        .benefit {
          --style: 'w-full flex items-center not-first:mt-12px';

          .tick {
            --style: mt-2px w-16px h-16px bg-contain flex-shrink-0 self-start;
            background-image: url('@/assets/tiny-tick.png');
          }

          .text {
            --style: ml-12px text-(14px) line-height-20px overflow-hidden whitespace-pre-wrap font-600;
            --style: 'text-#333333 dark:(text-#FFFFFFE6)';
          }

          &.highlighted {
            .tick {
              background-image: url('@/assets/tiny-tick-highlighted.png');
            }
            .text {
              --style: font-400;
              --style: 'text-#0F1419 dark:(text-#FFFFFFCC)';
            }
          }
        }
      }
    }

    .operate {
      --style: w-full mt-32px relative;

      .rule {
        --style: text-center text-13px;
        --style: 'text-#999 dark:(text-#FFFFFF66)';
      }

      button {
        --style: mt-12px w-full h-48px rounded-8px bg-#333333FF flex-center cursor-pointer transition-transform duration-250;
        --style: 'hover:scale-102 active:scale-105';

        span {
          --style: 'text-(16px #FFDCC1FF) font-500 line-height-22px';
        }
      }
    }
  }
}
</style>
