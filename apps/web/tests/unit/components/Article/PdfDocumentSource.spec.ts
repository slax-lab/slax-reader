import PdfDocumentSource from '~~/app/components/Article/Pdf/PdfDocumentSource.vue'
import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

describe('PdfDocumentSource', () => {
  it('links a saved PDF to its original URL and displays the embedded author', () => {
    const wrapper = mountWithApp(PdfDocumentSource, { props: {
      pdf: { source: 'url', filename: 'paper.pdf' }, url: 'https://arxiv.org/pdf/2608.00046', author: 'Jane Doe'
    } })
    expect(wrapper.find('a').attributes('href')).toBe('https://arxiv.org/pdf/2608.00046')
    expect(wrapper.find('.article-source-name').text()).toBe('arxiv.org')
    expect(wrapper.find('.article-source-author').text()).toBe('Jane Doe')
  })

  it('labels uploads with their filename without linking the synthetic URL', () => {
    const wrapper = mountWithApp(PdfDocumentSource, { props: {
      pdf: { source: 'upload', filename: 'paper.pdf' }, url: 'slax-pdf://7/hash', author: 'Jane Doe'
    } })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toContain('Local upload')
    expect(wrapper.find('.pdf-source-name').text()).toBe('paper.pdf')
    expect(wrapper.find('.pdf-source-author').text()).toBe('Jane Doe')
  })

  it('omits an absent author and keeps filenames as plain text', () => {
    const wrapper = mountWithApp(PdfDocumentSource, { props: {
      pdf: { source: 'upload', filename: '<script>paper.pdf</script>' }, author: ' '
    } })
    expect(wrapper.find('.pdf-source-author').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('<script>paper.pdf</script>')
  })
})
