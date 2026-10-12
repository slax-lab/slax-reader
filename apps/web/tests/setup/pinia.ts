import { createPinia, setActivePinia } from 'pinia'

export const createTestPinia = () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}
