export interface ApiKeyCreateResult<Time = string> {
  id: number
  name: string
  key: string
  created_at: Time
}

export interface ApiKeyListItem<Time = string> {
  id: number
  name: string
  short_key: string
  created_at: Time
}

export interface CreateApiKeyRequest {
  name?: string
}
export interface RollApiKeyRequest {
  name?: string
}
