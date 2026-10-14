import type {Purchase} from 'expo-iap';
import type {StorePort, StorePurchase} from './controller';

export function createExpoStore(): StorePort {
  let sdk: typeof import('expo-iap') | null = null;
  let remove: (() => void)[] = [];
  return {
    async start(onPurchase, onError) {
      sdk = await import('expo-iap');
      const updates = sdk.purchaseUpdatedListener(purchase => onPurchase(purchase));
      const errors = sdk.purchaseErrorListener(error => onError(error));
      remove = [() => updates.remove(), () => errors.remove()];
      try { if (!(await sdk.initConnection())) throw new Error('StoreKit is unavailable'); }
      catch (error) { remove.forEach(dispose => dispose()); remove = []; await sdk.endConnection(); sdk = null; throw error; }
    },
    async products(ids) { if (!sdk) throw new Error('StoreKit is unavailable'); await sdk.fetchProducts({skus: ids, type: 'subs'}); },
    async purchase({productId, orderId, offer}) {
      if (!sdk) throw new Error('StoreKit is unavailable');
      await sdk.requestPurchase({type: 'subs', request: {apple: {sku: productId, appAccountToken: orderId, andDangerouslyFinishTransactionAutomatically: false,
        ...(offer ? {withOffer: {identifier: offer.offerId, keyIdentifier: offer.keyID, nonce: offer.nonce, signature: offer.signature, timestamp: offer.timestamp}} : {})}}});
    },
    async finish(purchase) { if (!sdk) throw new Error('StoreKit is unavailable'); await sdk.finishTransaction({purchase: purchase as Purchase, isConsumable: false}); },
    async restore() { if (!sdk) throw new Error('StoreKit is unavailable'); await sdk.restorePurchases(); return await sdk.getAvailablePurchases() as StorePurchase[]; },
    async pending() { if (!sdk) throw new Error('StoreKit is unavailable'); return await sdk.getPendingTransactionsIOS() as StorePurchase[]; },
    async entitlements() { if (!sdk) throw new Error('StoreKit is unavailable'); return await sdk.getAvailablePurchases({onlyIncludeActiveItemsIOS: true}) as StorePurchase[]; },
    async stop() { remove.forEach(dispose => dispose()); remove = []; if (sdk) await sdk.endConnection(); sdk = null; },
  };
}
