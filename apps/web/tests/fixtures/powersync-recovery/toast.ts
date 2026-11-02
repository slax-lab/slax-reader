export const ToastType = { Error: 'error' }
export default {
  showToast({ text }: { text: string; type?: unknown }) {
    const output = document.querySelector('#feedback')
    if (output) output.textContent = text
  }
}
