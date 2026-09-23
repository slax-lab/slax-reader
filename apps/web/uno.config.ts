// uno.config.ts
//
// mergeConfigs：仓库根 uno.config.ts（presets/rules 基座）+ 本文件的两组 utility 桥接
//   1. dweb 通用 utility 桥接（bg-surface / text-txt / ...），对应 styles/theme.tokens.css
//   2. fork-only 派生变量的 utility 桥接（plan / chart 等业务专属），对应 app/assets/styles/fork.tokens.css
import baseConfig from './config/uno.base'
import { defineConfig, mergeConfigs } from 'unocss'

export default defineConfig(
  mergeConfigs([
    baseConfig,
    {
      theme: {
        // 扁平结构而非嵌套 { DEFAULT, ... }：UnoCSS 在嵌套 colors 上的 DEFAULT 隐式映射在
        // 当前 preset 组合（preset-wind3 + presetAttributify + presetRemToPx）下未稳定生效。
        // 扁平 key 让 `text-txt` / `bg-accent-bg` / `border-border` 等 utility 100% 走到 var(--slax-*)。
        colors: {
          bg: 'var(--slax-bg)',
          surface: 'var(--slax-surface)',
          'surface-solid': 'var(--slax-surface-solid)',
          'topbar-bg': 'var(--slax-topbar-bg)',
          border: 'var(--slax-border)',

          txt: 'var(--slax-text)',
          'txt-muted': 'var(--slax-text-muted)',
          'txt-light': 'var(--slax-text-light)',
          'txt-btn': 'var(--slax-btn-text)',

          accent: 'var(--slax-accent)',
          'accent-soft': 'var(--slax-accent-soft)',
          'accent-bg': 'var(--slax-accent-bg)',

          danger: 'var(--slax-danger)',
          'danger-bg': 'var(--slax-danger-bg)',

          selection: 'var(--slax-selection)'
        },
        boxShadow: {
          warm: 'var(--slax-shadow-warm)',
          sm: 'var(--slax-shadow-sm)'
        },
        borderRadius: {
          DEFAULT: 'var(--slax-radius)',
          sm: 'var(--slax-radius-sm)'
        },
        width: {
          sidebar: 'var(--slax-sidebar-w)',
          shell: 'var(--slax-shell-w)',
          content: 'var(--slax-content-w)',
          'content-min': 'var(--slax-content-min-w)',
          'side-panel': 'var(--slax-side-panel-w)',
          'side-panel-min': 'var(--slax-side-panel-min-w)',
          'side-panel-max': 'var(--slax-side-panel-max-w)'
        },
        maxWidth: {
          shell: 'var(--slax-shell-w)',
          content: 'var(--slax-content-w)',
          'side-panel-max': 'var(--slax-side-panel-max-w)'
        },
        minWidth: {
          content: 'var(--slax-content-min-w)',
          'side-panel-min': 'var(--slax-side-panel-min-w)'
        },
        height: {
          header: 'var(--slax-header-height)'
        },
        fontSize: {
          // 字号语义 8 档（来源：design-system §3）。业务侧 text-display / text-h2 / text-card / ...
          // 直接消费；非标值（15/18/24/34）在 task2 期间已按最近档映射，详见 .claude/task2-fontsize-shifts.md
          display: 'var(--slax-fs-display)',
          h2: 'var(--slax-fs-h2)',
          brand: 'var(--slax-fs-brand)',
          card: 'var(--slax-fs-card)',
          body: 'var(--slax-fs-body)',
          meta: 'var(--slax-fs-meta)',
          aux: 'var(--slax-fs-aux)',
          tag: 'var(--slax-fs-tag)'
        },
        fontFamily: {
          serif: ['Playfair Display', 'Noto Serif SC', 'serif'],
          sans: ['Inter', '-apple-system', 'sans-serif'],
          mono: ['SF Mono', 'Fira Code', 'monospace']
        },
        // 特效参数桥接（来源：design-system §6）。业务侧 utility：
        //   duration-fast / duration-normal、ease-spring。Tailwind 的 backdrop-blur 因接受
        //   单一 blur(...) 函数无法表达 "blur(16px) saturate(150%)" 复合滤镜，故 backdrop-filter
        //   仍直接写 `backdrop-filter: var(--slax-blur)`，不在此桥接 backdropBlur key。
        transitionDuration: {
          fast: 'var(--slax-dur-fast)',
          normal: 'var(--slax-dur-normal)'
        },
        transitionTimingFunction: {
          spring: 'var(--slax-ease-spring)'
        }
      }
    },
    {
      // fork 专属 utility 桥接（与 fork.tokens.css 内派生变量一一对应，理论校验见
      // tests/theme/fork-tokens.spec.ts）。独立一个 mergeConfigs 条目，与上面 upstream 段
      // 严格分离，不共享同一个 colors 对象——两段命名风格不同（upstream 段是 txt/bg-surface
      // 这种简写，fork 段是与 --slax-* 变量名逐字对应的全名），混在一起会让静态校验无法
      // 用简单规则区分两段，也会让未来新增/删除 fork token 时误判 upstream 段。
      theme: {
        colors: {
          // 命名规则：utility key 去掉 `--slax-` 前缀的小写连字符形式
          //   --slax-plan-highlight    → plan-highlight
          //   --slax-subscribe-cta-bg  → subscribe-cta-bg
          //   --slax-chart-primary     → chart-primary
          'plan-highlight': 'var(--slax-plan-highlight)',
          'plan-highlight-bg': 'var(--slax-plan-highlight-bg)',
          'plan-card-border': 'var(--slax-plan-card-border)',
          'subscribe-cta-bg': 'var(--slax-subscribe-cta-bg)',
          'subscribe-cta-text': 'var(--slax-subscribe-cta-text)',
          'subscribe-cta-bg-hover': 'var(--slax-subscribe-cta-bg-hover)',
          'stripe-trust': 'var(--slax-stripe-trust)',
          'chart-primary': 'var(--slax-chart-primary)',
          'chart-primary-rgb': 'var(--slax-chart-primary-rgb)',
          'chart-primary-hover': 'var(--slax-chart-primary-hover)',
          'chart-gold': 'var(--slax-chart-gold)',
          'chart-gold-rgb': 'var(--slax-chart-gold-rgb)',
          'chart-gold-dark-rgb': 'var(--slax-chart-gold-dark-rgb)',
          'chart-grid': 'var(--slax-chart-grid)',
          'chart-axis': 'var(--slax-chart-axis)',
          'chart-tooltip-bg': 'var(--slax-chart-tooltip-bg)',
          'chart-tooltip-text': 'var(--slax-chart-tooltip-text)',
          // PaymentModal / InviteCodeModal 专属
          'payment-success-grad-from': 'var(--slax-payment-success-grad-from)',
          'payment-cta-hover': 'var(--slax-payment-cta-hover)',
          'modal-overlay-rgb': 'var(--slax-modal-overlay-rgb)',
          'modal-content-bg': 'var(--slax-modal-content-bg)',
          'modal-warm-bg': 'var(--slax-modal-warm-bg)',
          'payment-card-border': 'var(--slax-payment-card-border)',
          'payment-text-primary': 'var(--slax-payment-text-primary)',
          'payment-text-placeholder': 'var(--slax-payment-text-placeholder)',
          // PlanCard 业务专属
          'text-deep': 'var(--slax-text-deep)',
          'discount-text': 'var(--slax-discount-text)',
          'discount-bg-from-rgb': 'var(--slax-discount-bg-from-rgb)',
          'discount-bg-to-rgb': 'var(--slax-discount-bg-to-rgb)',
          'plan-neutral-bg': 'var(--slax-plan-neutral-bg)',
          'plan-neutral-bg-hover': 'var(--slax-plan-neutral-bg-hover)',
          'plan-secondary-text': 'var(--slax-plan-secondary-text)',
          // PlanPayment 专属
          'tips-warn': 'var(--slax-tips-warn)',
          'overlay-white-rgb': 'var(--slax-overlay-white-rgb)',
          // SubscribeButton 专属
          'subscribe-dark-from': 'var(--slax-subscribe-dark-from)',
          'subscribe-dark-to': 'var(--slax-subscribe-dark-to)',
          'subscribe-peach-text': 'var(--slax-subscribe-peach-text)',
          // Collection 业务专属
          'payment-text-primary-rgb': 'var(--slax-payment-text-primary-rgb)',
          'payment-text-placeholder-rgb': 'var(--slax-payment-text-placeholder-rgb)',
          'collection-toggle-off': 'var(--slax-collection-toggle-off)',
          'collection-link': 'var(--slax-collection-link)',
          'collection-tag': 'var(--slax-collection-tag)',
          'collection-unread': 'var(--slax-collection-unread)',
          // Homepage 业务专属
          'homepage-premium-grad': 'var(--slax-homepage-premium-grad)',
          'homepage-koc-dark-to': 'var(--slax-homepage-koc-dark-to)',
          'homepage-koc-link': 'var(--slax-homepage-koc-link)',
          'homepage-koc-link-hover': 'var(--slax-homepage-koc-link-hover)',
          // ThirdPartyImport 业务专属
          'import-text-dark': 'var(--slax-import-text-dark)',
          'import-text-mid': 'var(--slax-import-text-mid)',
          'import-text-secondary': 'var(--slax-import-text-secondary)',
          'import-text-muted': 'var(--slax-import-text-muted)',
          'import-text-light': 'var(--slax-import-text-light)',
          'import-border': 'var(--slax-import-border)',
          'import-border-mid': 'var(--slax-import-border-mid)',
          'import-bg-subtle': 'var(--slax-import-bg-subtle)',
          'import-bg-light': 'var(--slax-import-bg-light)',
          'import-divider': 'var(--slax-import-divider)',
          'import-tag-bg': 'var(--slax-import-tag-bg)',
          'import-selected-bg': 'var(--slax-import-selected-bg)',
          'collection-tag-rgb': 'var(--slax-collection-tag-rgb)',
          'import-success-bg': 'var(--slax-import-success-bg)',
          'import-success-text': 'var(--slax-import-success-text)',
          'import-success-border': 'var(--slax-import-success-border)',
          'import-warn-bg': 'var(--slax-import-warn-bg)',
          'import-warn-text': 'var(--slax-import-warn-text)',
          'import-warn-border': 'var(--slax-import-warn-border)',
          'import-error-bg': 'var(--slax-import-error-bg)',
          'import-error-text': 'var(--slax-import-error-text)',
          'import-error-border': 'var(--slax-import-error-border)',
          'import-info-bg': 'var(--slax-import-info-bg)',
          'import-info-text': 'var(--slax-import-info-text)',
          'import-info-border': 'var(--slax-import-info-border)',
          'import-danger-btn': 'var(--slax-import-danger-btn)',
          'import-danger-btn-hover': 'var(--slax-import-danger-btn-hover)',
          'import-danger2-btn': 'var(--slax-import-danger2-btn)',
          'import-danger2-btn-hover': 'var(--slax-import-danger2-btn-hover)',
          'import-error-detail-bg': 'var(--slax-import-error-detail-bg)',
          'import-error-detail-text': 'var(--slax-import-error-detail-text)',
          'import-error-detail-dark': 'var(--slax-import-error-detail-dark)',
          // CollectionHeader / global 专属
          'collection-gold': 'var(--slax-collection-gold)',
          'collection-gold-rgb': 'var(--slax-collection-gold-rgb)',
          'collection-gold-text': 'var(--slax-collection-gold-text)'
        }
      }
    }
  ])
)
