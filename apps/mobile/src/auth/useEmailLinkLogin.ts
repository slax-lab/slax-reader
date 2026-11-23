import {useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {EmailLinkLoginController} from './email-link-login';

export function useEmailLinkLogin(options: ConstructorParameters<typeof EmailLinkLoginController>[0]) {
  const launch = useRef({handled: false});
  const {source, api, sessions, webOrigin} = options;
  const controller = useMemo(() => new EmailLinkLoginController({source, api, sessions, webOrigin}), [source, api, sessions, webOrigin]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {controller.start(launch.current); return () => controller.dispose();}, [controller]);
  return useMemo(() => ({state, confirm: controller.confirm, dismiss: controller.dismiss, continueOnWeb: controller.continueOnWeb}), [state, controller]);
}
