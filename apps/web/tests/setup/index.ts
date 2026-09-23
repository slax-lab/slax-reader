import './globalMocks'
import { beforeEach } from 'vitest'

// 每个测试前清空 DOM，避免上一个用例渲染残留污染查询
beforeEach(() => {
  document.body.innerHTML = ''
})
