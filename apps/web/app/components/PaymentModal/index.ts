import InviteCode from './InviteCodeModal.vue'
import Payment from './PaymentModal.vue'

export const showPaymentModal = (paymentData: { type: string; priceId: string }, completeHandler?: (success: boolean) => void) => {
  const app = modalBootloader({
    ele: Payment,
    props: {
      onDismiss: (success: boolean) => {
        app.unmount()
        app._container?.remove()
        completeHandler && completeHandler(success)
      },
      ...paymentData
    }
  })
}

export const showRedeemModal = (completeHandler?: (success: boolean) => void) => {
  const app = modalBootloader({
    ele: InviteCode,
    props: {
      onDismiss: (success: boolean) => {
        app.unmount()
        app._container?.remove()
        completeHandler && completeHandler(success)
      }
    }
  })
}
