import { createApp } from 'vue'
import PdfSave from './PdfSave.vue'
import { captureVueErrors, installClientErrorLog } from '@/utils/clientErrorLog'

installClientErrorLog('page')
const app = createApp(PdfSave)
captureVueErrors(app)
app.mount('#app')
