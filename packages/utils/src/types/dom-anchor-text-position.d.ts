/**
 * dom-anchor-text-position 类型声明
 */
declare module 'dom-anchor-text-position' {
  /**
   * 将文本位置转换为 DOM Range
   * @param root 根元素
   * @param selector 位置选择器
   * @returns DOM Range 对象
   */
  export function toRange(root: Node, selector: { start: number; end: number }): Range | null

  /**
   * 将 DOM Range 转换为文本位置
   * @param root 根元素
   * @param range DOM Range 对象
   * @returns 位置选择器
   */
  export function fromRange(root: Node, range: Range): { start: number; end: number }
}
