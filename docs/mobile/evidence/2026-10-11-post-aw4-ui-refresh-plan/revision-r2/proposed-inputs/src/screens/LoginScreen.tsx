import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, Image, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {WebView} from 'react-native-webview';
import {mobileAssets} from '../../assets';
import {authenticate, type LoginProvider} from '../auth/providers';
import {useMobile} from '../runtime';
import {mobileColors as C, mobileLayout as L, mobileTypography as T} from '../theme';
import {mobileTestIds} from '../theme/testIds';
import {useTelemetry} from '../telemetry';
import {fixtureDocument} from '../native/fixture-document';
import {fixtureActions} from '../components/fixture-actions';

export function LoginScreen() {
  const {api, sessions, t, config, fixtureOnly} = useMobile();
  const telemetry = useTelemetry();
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [agreed, setAgreed] = useState(false);
  const [agreement, setAgreement] = useState<'terms'|'privacy'|null>(null);
  const [loading, setLoading] = useState<LoginProvider|null>(null);
  const pending = useRef<LoginProvider|null>(null);
  const active = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false; pending.current = null;};}, []);
  async function login(provider: LoginProvider) {
    if (active.current) return;
    active.current = true; setLoading(provider);
    try {
      telemetry.element(`login_${provider}_button`, 'signup');
      const request = await (fixtureOnly ? fixtureOnly.authenticate?.(provider) ?? Promise.resolve(null) : authenticate(provider)).finally(() => telemetry.firebase('user', 'login_start', {method: provider}));
      if (!request || !mounted.current) return;
      const result = await api.login(request);
      if (!mounted.current) return;
      await sessions.accept(result.token, result.user_id);
    } catch (error) {
      if (mounted.current) Alert.alert(t('login_failed'), error instanceof Error ? error.message : t('login_failed'), [{text: t('btn_ok')}]);
    } finally { active.current = false; if (mounted.current) setLoading(null); }
  }
  function begin(provider: LoginProvider) {
    if (loading) return;
    if (!agreed) { pending.current = provider; setAgreement(provider === 'google' ? 'terms' : 'privacy'); }
    else void login(provider);
  }
  function dismissAgreement() { pending.current = null; setAgreement(null); }
  function acceptAgreement() {
    const provider = pending.current; pending.current = null;
    setAgreed(true); setAgreement(null);
    if (provider) void login(provider);
  }
  useEffect(() => {
    if (!__DEV__ || !fixtureOnly) return;
    return fixtureActions.subscribe('login', action => {
      if (action.kind === 'begin-login') {
        if (action.provider !== 'google' && !(action.provider === 'apple' && Platform.OS === 'ios')) throw new Error('Provider is unavailable on this fixture platform');
        begin(action.provider); return true;
      }
      if (action.kind === 'accept-agreement') {if (!agreement) throw new Error('No agreement is open'); acceptAgreement(); return true;}
      if (action.kind === 'dismiss-agreement') {if (!agreement) throw new Error('No agreement is open'); dismissAgreement(); return true;}
      if (action.kind === 'select-agreement') {if (!agreement || !['terms', 'privacy'].includes(String(action.agreement))) throw new Error('Invalid agreement fixture transition'); setAgreement(action.agreement as 'terms'|'privacy'); return true;}
      if (action.kind === 'toggle-agreed') {setAgreed(value => !value); return true;}
      return false;
    });
  }, [fixtureOnly, agreement, loading, agreed]);
  const button = (provider: LoginProvider) => <Pressable
    accessibilityRole="button" accessibilityLabel={t(`login_${provider}`)}
    testID={`${mobileTestIds.LoginButton}_${provider}`} disabled={Boolean(loading)}
    onPress={() => begin(provider)} style={({pressed}) => [styles.provider, {width: Math.min(width - 80, L.loginButtonMaximumWidth)}, provider === 'apple' && {marginTop: 10}, pressed && {backgroundColor: C.pressedOverlay}]}>
    {loading === provider ? <ActivityIndicator size="small" color={C.text} testID={mobileTestIds.LoginLoadingIndicator}/> : <>
      <Image source={provider === 'google' ? mobileAssets.ic_sm_google : mobileAssets.ic_sm_apple} style={styles.providerIcon}/>
      <Text style={styles.providerText}>{t(`login_${provider}`)}</Text>
    </>}
  </Pressable>;
  return <View style={[styles.root, {paddingBottom: insets.bottom}]}>
    <View style={styles.top}>
      <View style={{height: Math.min(width * 128 / 375, 128)}}/>
      <Text style={styles.title}>{t('login_welcome_title')}</Text>
      <View>
        <Image source={mobileAssets.bg_login} style={{width, aspectRatio: L.loginArtworkAspectRatio}} resizeMode="contain"/>
        <Text style={styles.subtitle}>{t('login_welcome_subtitle')}</Text>
      </View>
    </View>
    <View style={styles.bottom}>
      {button('google')}
      {Platform.OS === 'ios' && button('apple')}
      <View style={styles.agreementRow}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{checked: agreed}} accessibilityLabel={t('agreement_prefix')} onPress={() => setAgreed(value => !value)} hitSlop={12}>
          <Image source={agreed ? mobileAssets.ic_agree_enable : mobileAssets.ic_agree_disable} style={{width: 12, height: 12}}/>
        </Pressable>
        <Text style={styles.agreementText}>{t('agreement_prefix')}
          <Text accessibilityRole="link" style={styles.link} onPress={() => setAgreement('terms')}>{t('agreement_user_agreement')}</Text>
          {t('agreement_and')}
          <Text accessibilityRole="link" style={styles.link} onPress={() => setAgreement('privacy')}>{t('agreement_privacy_policy')}</Text>
        </Text>
      </View>
    </View>
    <Modal visible={agreement !== null} transparent animationType="slide" onRequestClose={dismissAgreement}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('btn_close')} onPress={dismissAgreement}/>
        <View accessibilityViewIsModal style={[styles.sheet, {height: height * 0.8, paddingBottom: insets.bottom}]}>
          <View style={styles.tabs}>{(['terms','privacy'] as const).map(tab => <Pressable key={tab} onPress={() => setAgreement(tab)} style={styles.tab} accessibilityRole="tab" accessibilityState={{selected: agreement === tab}}>
            <Text style={[styles.tabText, agreement === tab && {color: C.text, fontWeight: '600'}]}>{t(`agreement_tab_${tab}`)}</Text>
          </Pressable>)}</View>
          <View style={styles.divider}/>
          {agreement && <WebView key={agreement} style={{flex: 1}} incognito={Boolean(fixtureOnly)}
            source={fixtureOnly ? {html: fixtureDocument(fixtureOnly.agreementHtml?.[agreement] ?? '<html><head></head><body><p>Controlled agreement fixture. External content and provider accounts are disabled.</p></body></html>'), baseUrl: 'https://reader-fixture.test'} : {uri: `${config.webUrl}/${agreement}`}}
            onShouldStartLoadWithRequest={(request: {url: string}) => !fixtureOnly || request.url === 'about:blank' || request.url === 'https://reader-fixture.test/'}/>}
          <View style={styles.divider}/>
          <Pressable accessibilityRole="button" onPress={acceptAgreement} style={styles.agreeButton}><Text style={styles.agreeText}>{t('agreement_btn_agree')}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={dismissAgreement} style={styles.disagreeButton}><Text style={styles.disagreeText}>{t('agreement_btn_disagree')}</Text></Pressable>
        </View>
      </View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: C.surface}, top: {flex: 1},
  title: {...T.loginTitle, color: C.text, marginLeft: 40},
  subtitle: {...T.loginSubtitle, color: C.secondaryText, position: 'absolute', left: 40, top: 24},
  bottom: {alignItems: 'center', marginTop: 16, marginBottom: 30},
  provider: {height: 50, borderRadius: 25, borderColor: C.buttonBorder, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center', flexDirection: 'row'},
  providerIcon: {width: 24, height: 24}, providerText: {fontSize: 15, lineHeight: 21, fontWeight: '500', color: C.bodyText, marginLeft: 10},
  agreementRow: {marginTop: 30, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24},
  agreementText: {fontSize: 12, lineHeight: 16.5, color: C.secondaryText, marginLeft: 6}, link: {color: C.link},
  modalBackdrop: {flex: 1, backgroundColor: C.scrim, justifyContent: 'flex-end'},
  sheet: {backgroundColor: C.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16},
  tabs: {marginHorizontal: 24, marginTop: 24, height: 40, flexDirection: 'row'}, tab: {flex: 1, justifyContent: 'center', paddingVertical: 8},
  tabText: {fontSize: 16, lineHeight: 20, color: C.mutedText}, divider: {height: 1, marginTop: 8, backgroundColor: '#33333314'},
  agreeButton: {marginHorizontal: 16, marginTop: 20, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent},
  agreeText: {...T.button, color: C.surface}, disagreeButton: {marginHorizontal: 16, marginTop: 8, height: 50, alignItems: 'center', justifyContent: 'center'},
  disagreeText: {fontSize: 15, lineHeight: 21, color: C.mutedText},
});
