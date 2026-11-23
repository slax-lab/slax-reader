import {Linking} from 'react-native';
import type {EmailLinkSource} from '../auth/email-link-login';

export const nativeEmailLinks: EmailLinkSource = {
  initialURL: () => Linking.getInitialURL(),
  subscribe(listener) {const subscription = Linking.addEventListener('url', event => listener(event.url)); return () => subscription.remove();},
  async openURL(url) {await Linking.openURL(url);},
};
