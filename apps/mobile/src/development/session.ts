/** Replaced by Metro only for an explicitly configured development session. */
export interface DevelopmentSession {
  apiUrl: string;
  powerSyncUrl: string;
  webUrl: string;
  webDomain: string;
  token: string;
  userId: string;
}
export const developmentSession: DevelopmentSession | null = null;
