export const ToastType = { Error: 'error' }
export default {
  showToast({ text }: { text: string; type?: unknown }) {
    const output = document.querySelector('#feedback')
    if (output) {
      output.dataset.toastCount = String(Number(output.dataset.toastCount || 0) + 1)
      output.textContent = text
    }
  }
}
