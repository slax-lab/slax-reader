import type { DOMProcessor, WebProcessorContext } from './types'

/**
 * 保留 <p> 内的源码换行：正文默认 `white-space: normal` 会把换行折叠成空格，
 * 诗歌/地址/逐行文本等靠换行分行的段落会丢排版。检测到「多行内容」的 <p>
 * 就落一个 marker 子节点，交给 CSS `p:has(> .oc-preline-flag)` 切成 pre-line。
 *
 * 只认「真·换行控制符」（U+000A/U+000D/U+000B/U+000C/U+0085 等，不可见）——
 * 它们才会被 normal 折叠。可见的两字符 `\n`（反斜杠 + 字母 n）是要显示的文字、
 * 不是换行，normal 不会折叠它，因此绝不匹配、绝不标记。
 */

// 仅匹配换行控制字符（字符类内均为控制符转义），不匹配可见的两字符串 `\n`。
// U+2028/U+2029 在 normal 下本就强制换行、无需 pre-line，纳入无害。
const LINE_BREAK_RE = /\r\n|[\n\r\v\f\x85\u2028\u2029]/

export const PRELINE_FLAG_CLASS = 'oc-preline-flag'
export const PRELINE_FLAG_HTML = `<template class="${PRELINE_FLAG_CLASS}"></template>`

/**
 * 「多行内容」判定：按换行控制符切分，逐段 trim 后过滤空段，
 * 剩余有内容的行 ≥ 2 才算多行。
 * - 避开源码美化缩进（`<p>\n  内容 \n</p>` 只有 1 行内容）误判；
 * - 避开可见 `\n` 文字（不含控制符，split 不拆，仍算单行）误判。
 */
export function isMultiLine(text: string): boolean {
  return (
    text
      .split(LINE_BREAK_RE)
      .map(line => line.trim())
      .filter(Boolean).length >= 2
  )
}

function markPreline(el: HTMLElement): void {
  const marker = document.createElement('template')
  marker.className = PRELINE_FLAG_CLASS
  el.appendChild(marker)
}

export class PreLineProcessor implements DOMProcessor {
  readonly name = 'PreLineProcessor'

  match(): boolean {
    return true
  }

  process(context: WebProcessorContext): void {
    const root = context.container.querySelector<HTMLElement>(':scope > .html-text')
    if (!root) return

    const paragraphs = Array.from(root.querySelectorAll<HTMLElement>('p'))

    for (const el of paragraphs) {
      // 幂等：SSR 已插过 marker 则跳过
      if (el.querySelector(`:scope > .${PRELINE_FLAG_CLASS}`)) continue
      if (!isMultiLine(el.textContent ?? '')) continue

      markPreline(el)
    }
  }

  // SSR 已并入 BlankMark 同遍（见 blank-mark.processor.ts），
  // 避免同一 <p> 两个 onEndTag 被引擎丢弃
}
