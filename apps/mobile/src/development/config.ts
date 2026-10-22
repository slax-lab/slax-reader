import {mobileConfig as defaults} from '../config';
import {developmentSession} from './session';
export const mobileConfig = __DEV__ && developmentSession ? {
  ...defaults,
  development: true,
  apiUrl: developmentSession.apiUrl,
  betaApiUrl: developmentSession.apiUrl,
  webUrl: developmentSession.webUrl,
  webDomain: developmentSession.webDomain,
} : defaults;
