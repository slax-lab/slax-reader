import CancelCollectionModal from './CancelCollectionModal.vue'
import RemoveCollectionModal from './RemoveCollectionModal.vue'

const showCancelCollectionModal = (options: {
  collection: {
    collection_code: string
    collection_name: string
    is_free?: boolean
    subscrition_end_time?: string
  }
  callback?: () => void
}) => {
  const collection = options.collection
  const app = modalBootloader({
    ele: CancelCollectionModal,
    props: {
      collection: {
        collection_code: collection.collection_code,
        collection_name: collection.collection_name,
        is_free: collection.is_free || false,
        subscrition_end_time: collection.subscrition_end_time || ''
      },
      onDismiss: () => {
        app.unmount()
        app._container?.remove()
      },
      onSuccess: () => {
        options.callback && options.callback()
      }
    }
  })
}

const showRemoveCollectionModal = (options: {
  collection: {
    collection_code: string
    collection_name: string
  }
  callback?: () => void
}) => {
  const collection = options.collection
  const app = modalBootloader({
    ele: RemoveCollectionModal,
    props: {
      collection: {
        collection_code: collection.collection_code,
        collection_name: collection.collection_name
      },
      onDismiss: () => {
        app.unmount()
        app._container?.remove()
      },
      onSuccess: () => {
        options.callback && options.callback()
      }
    }
  })
}

export default {
  showCancelCollectionModal,
  showRemoveCollectionModal
}
