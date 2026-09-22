/** Browser-extension panel position persisted in local storage. */
export interface PanelPosition {
  left?: string
  top?: string
  width?: string
  height?: string
}

/** Browser-extension-only local configuration. */
export interface LocalConfig {
  webPanelPosition?: PanelPosition
  autoToggle?: boolean
  sidebarWidthSync?: boolean
}
