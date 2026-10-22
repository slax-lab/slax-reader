export type UpgradeStatus = 'checking' | 'ready' | 'verification-required' | 'error' | string;

export const libraryRecoveryVisible = (dataReady: boolean, upgradeStatus: UpgradeStatus) =>
  !dataReady && (upgradeStatus === 'error' || upgradeStatus === 'verification-required');

export const libraryIsInteractive = (rowsReady: boolean, dataReady: boolean, upgradeStatus: UpgradeStatus) =>
  rowsReady || libraryRecoveryVisible(dataReady, upgradeStatus);

export const readerIsInteractive = (documentReady: boolean, contentError: unknown, rssError: unknown, nativeFailure: unknown) =>
  documentReady || Boolean(contentError) || Boolean(rssError) || Boolean(nativeFailure);
