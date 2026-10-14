<template>
  <div class="plan-card">
    <div class="plan" v-for="(plan, index) in plans" :key="plan.title" :class="{ highlighted: index === selectedIndex }">
      <div class="plan-tip-title" v-if="index === selectedIndex">{{ plan.tipTitle }}</div>
      <div class="plan-content">
        <div class="title">{{ plan.title }}</div>
        <div class="price">
          <div class="amount">{{ plan.unit }}{{ plan.price }}</div>
          <div class="period">{{ plan.period }}</div>
          <div class="original" v-if="plan.original">({{ plan.unit }}{{ plan.original }})</div>
        </div>
        <div class="discount" :class="{ highlighted: index === selectedIndex }">{{ plan.discount }}</div>
        <div class="benefits">
          <div :class="{ free: benefitIdx === 0, pro: benefitIdx === 1 }" v-for="(benefit, benefitIdx) in [plan.free, plan.pro]" :key="benefitIdx" v-show="benefit.length > 0">
            <div class="benefit" :class="{ highlighted: benefitIdx === 1 }" v-for="item in benefit" :key="item.name">
              <div class="tick"></div>
              <div class="text" :class="{ bold: item.bold }">
                <span>{{ item.name }}</span
                ><span class="wip" v-if="item.wip"><br />{{ t('component.plan_card.wip') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="operate">
        <button :class="{ highlighted: index === selectedIndex }" @click="btnClick(index)">
          <span>{{ plan.operateText }} {{ index === selectedIndex ? `(${plan.unit}${plan.price})` : '' }}</span>
        </button>
        <div class="month_rule" v-if="index === selectedIndex">
          {{ t('component.plan_card.subscribe_month_rule') }}
        </div>
        <button v-if="index !== 0" class="one-time-btn" @click="oneTimeClick(index)">
          <span>{{ t('component.plan_card.one_time_purchase') }} ({{ plan.unit }}{{ plan.oncePrice }})</span>
        </button>
        <div class="one_time_rule" v-if="index === selectedIndex">
          {{ t('component.plan_card.one_time_purchase_rule') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { showPaymentModal } from './PaymentModal'

interface PlanItem {
  title: string
  unit: string
  price: number
  oncePrice: number
  period: string
  original?: number
  operateText: string
  tipTitle: string
  discount: string
  free: { name: string; wip: boolean; bold?: boolean }[]
  pro: { name: string; wip: boolean; bold?: boolean }[]
}

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

const plans = computed(() => {
  return [
    {
      title: t('component.plan_card.plans.1.title'),
      tipTitle: t('component.plan_card.plans.1.tip_title'),
      discount: t('component.plan_card.plans.1.discount'),
      unit: '$',
      price: 0,
      period: t('component.plan_card.plans.1.period'),
      operateText: t('component.plan_card.plans.1.operate_title'),
      free: [
        {
          name: t('component.plan_card.plans.1.free_features.1'),
          wip: false
        },
        {
          name: t('component.plan_card.plans.1.free_features.2'),
          wip: false
        },
        {
          name: t('component.plan_card.plans.1.free_features.3'),
          wip: false
        },
        {
          name: t('component.plan_card.plans.1.free_features.4'),
          wip: false
        },
        {
          name: t('component.plan_card.plans.1.free_features.5'),
          wip: false
        },
        {
          name: t('component.plan_card.plans.1.free_features.6'),
          wip: false
        }
      ],
      pro: []
    },
    {
      title: t('component.plan_card.plans.2.title'),
      tipTitle: t('component.plan_card.plans.2.tip_title'),
      discount: t('component.plan_card.plans.2.discount'),
      unit: '$',
      price: 5.99,
      period: t('component.plan_card.plans.2.period'),
      original: 9.99,
      operateText: t('component.plan_card.plans.2.operate_title'),
      oncePrice: 9.99,
      free: [
        {
          name: t('component.plan_card.plans.2.free_features.1'),
          wip: false,
          bold: true
        }
      ],
      pro: [
        {
          name: t('component.plan_card.plans.2.pro_features.1'),
          wip: false
        },
        {
          name: t('component.plan_card.plans.2.pro_features.2'),
          wip: false
        },

        {
          name: t('component.plan_card.plans.2.pro_features.3'),
          wip: false
        },

        {
          name: t('component.plan_card.plans.2.pro_features.4'),
          wip: false
        },
        {
          name: t('component.plan_card.plans.2.pro_features.5'),
          wip: false
        },
        {
          name: t('component.plan_card.plans.2.pro_features.6'),
          wip: false
        }
      ]
    }
  ] as PlanItem[]
})

const selectedIndex = 1
const btnClick = (index: number) => {
  if (index !== selectedIndex) {
    return
  }

  try {
    const $config = useNuxtApp().$config.public
    showPaymentModal({ type: 'sub', priceId: `${$config.STRIPE_SUB_PRICE_ID}` }, success => {
      if (success) {
        postChannelMessage('refresh', { type: 'page' })
        window.location.reload()
      }
    })
  } catch (e) {
    alert((e as Error).message)
  }
}

const oneTimeClick = (index: number) => {
  if (index !== selectedIndex) {
    return
  }

  try {
    const $config = useNuxtApp().$config.public
    showPaymentModal({ type: 'once', priceId: `${$config.STRIPE_ONCE_PRICE_ID}` }, success => {
      if (success) {
        postChannelMessage('refresh', { type: 'page' })
        window.location.reload()
      }
    })
  } catch (e) {
    alert((e as Error).message)
  }
}
</script>

<style lang="scss" scoped>
.plan-card {
  --style: 'flex justify-center items-stretch max-md:(flex-col) md:(flex-row)';

  & > * {
    --style: 'max-md:(not-first:mt-16px) md:(not-first:ml-16px)';
  }

  .plan {
    --style: relative p-24px pb-50px w-332px min-h-342px bg-surface-solid rounded-16px border-(1px solid var(--slax-payment-card-border)) flex flex-col items-center justify-between;

    &.highlighted {
      --style: 'border-2 border-chart-primary transition-transform duration-250 hover:scale-102';

      .plan-tip-title {
        --style: absolute top-0 right-0 px-10px h-26px bg-chart-primary text-(14px white) font-600 line-height-26px rounded-tr-14px rounded-bl-14px flex-center bg-gradient-to-br
          from-payment-success-grad-from to-chart-primary;
      }
    }

    .plan-content {
      --style: w-full flex flex-(col 1);

      .title {
        --style: w-full text-(16px payment-text-primary) line-height-22px font-600;
        font-family: var(--slax-font-serif);
      }

      .price {
        --style: mt-16px w-full flex items-center;

        .amount {
          --style: font-600 text-(32px text-deep ellipsis) line-height-45px flex-shrink-1 overflow-hidden whitespace-nowrap;
        }

        .period,
        .original {
          --style: ml-8px -mb-8px font-500 text-(14px payment-text-placeholder) line-height-20px flex-shrink-0;
        }

        .original {
          --style: line-through;
        }
      }

      .discount {
        --style: w-fit h-22px mt-6px rounded-6px text-(12px discount-text);
        &.highlighted {
          --style: px-3px py-2px;
        }
        background: linear-gradient(135deg, rgba(var(--slax-discount-bg-from-rgb), 0.12) 0%, rgba(var(--slax-discount-bg-to-rgb), 0.12) 100%);
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
            background-image: url('@images/tiny-tick.png');
          }

          .text {
            --style: ml-12px font-400 text-(14px payment-text-primary) line-height-20px overflow-hidden whitespace-pre-wrap;
            .wip {
              --style: font-400 text-(14px payment-text-placeholder) line-height-20px whitespace-pre;
            }
            &.bold {
              --style: font-600 text-text-deep;
            }
          }

          &.highlighted {
            .tick {
              background-image: url('@images/tiny-tick-highlighted.png');
            }
            .text {
              --style: text-payment-text-primary;
            }
          }
        }
      }
    }

    .operate {
      --style: w-full mt-24px relative;
      button {
        --style: w-full h-48px rounded-8px bg-payment-card-border flex-center cursor-auto;
        span {
          --style: 'text-(16px payment-text-placeholder) font-600 line-height-22px';
        }

        &.highlighted {
          --style: 'bg-chart-primary cursor-pointer transition-transform duration-250 hover:scale-102 active:scale-105';
          span {
            --style: text-white;
          }
        }

        &.one-time-btn {
          --style: 'mt-12px bg-plan-neutral-bg cursor-pointer hover:bg-plan-neutral-bg-hover';
          span {
            --style: 'text-(16px plan-secondary-text) font-500';
          }
        }
      }
      .month_rule {
        --style: text-center text-13px text-payment-text-placeholder mt-6px mb-24px;
      }
      .one_time_rule {
        --style: absolute bottom-(-6px) left-0 w-full text-center text-13px text-payment-text-placeholder mt-6px;
        transform: translateY(100%);
      }
      .no_auto_renewal {
        --style: text-center text-14px text-payment-text-placeholder mb-12px;
      }
    }
  }
}
</style>
