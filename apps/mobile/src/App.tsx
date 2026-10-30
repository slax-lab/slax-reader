import React, {useEffect, useRef} from 'react';
import * as AppIntents from 'expo-app-intents';
import {Platform, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {createNavigationContainerRef, StackActions} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {MobileProvider, useMobile} from './runtime';
import {mobileColors as C} from './theme';
import type {RootStackParams} from './navigation/types';
import {useTelemetry} from './telemetry';
import {SourceLine} from './components/SourceLine';
import {AppRecoveryScreen} from './screens/AppRecoveryScreen';
import {ObserveNavigationContainer, ObserveRoot} from './observe';
import {readerScreenOptions, useReaderPrewarm} from './navigation/reader-route';

const screens = {
  Login: () => require('./screens/LoginScreen').LoginScreen,
  Library: () => require('./screens/LibraryScreen').LibraryScreen,
  Search: () => require('./screens/SearchScreen').SearchScreen,
  Reader: () => require('./screens/ReaderScreen').ReaderScreen,
  Settings: () => require('./screens/SettingsScreen').SettingsScreen,
  About: () => require('./screens/AboutScreen').AboutScreen,
  Feedback: () => require('./screens/FeedbackScreen').FeedbackScreen,
  DeleteAccount: () => require('./screens/DeleteAccountScreen').DeleteAccountScreen,
  Subscription: () => require('./screens/SubscriptionScreen').SubscriptionScreen,
  Debug: () => require('./screens/DebugScreen').DebugScreen,
  DiagnosticLog: () => require('./screens/DiagnosticLogScreen').DiagnosticLogScreen,
};

const Stack = createNativeStackNavigator<RootStackParams>();
export const navigationRef = createNavigationContainerRef<RootStackParams>();
const setObserveNavigationRef = (ref: unknown) => {navigationRef.current = ref as typeof navigationRef.current;};

function SourceHeaderTitle({title}: {title: string}) {
  const {fontScale} = useWindowDimensions();
  // Center the source 17sp title in its 64dp app bar while retaining the native
  // 56dp Android toolbar and back button. TextPaint preserves fractional sp.
  return <View accessible accessibilityRole="header" accessibilityLabel={title} style={{height: 24 * fontScale, maxWidth: '100%', alignItems: 'center', justifyContent: 'center', transform: [{translateY: 4}]}}>
    <SourceLine text={title} fontSize={17} lineHeight={24} fontWeight={500} color={C.text} alignment="center" fitContent style={{alignSelf: 'center', maxWidth: '100%'}} />
  </View>;
}
const sourceHeaderTitle = Platform.OS === 'android'
  ? ({children}: {children: string}) => <SourceHeaderTitle title={children}/>
  : undefined;

export function ApplicationRoutes() {
  const {session, upgrade, retryStart, t, systemEntry, runtime} = useMobile();
  const telemetry = useTelemetry();
  const reported = useRef(new Set<string>());
  const userId = session.status === 'authenticated' ? session.session.userId : null;
  useEffect(() => { telemetry.identify(userId); }, [telemetry, userId]);
  useEffect(() => () => systemEntry?.setNavigator(null), [systemEntry]);
  useReaderPrewarm(session.status === 'authenticated' ? runtime : undefined);
  function reportRoutes() {
    const state = navigationRef.getRootState();
    if (!state) return;
    const active = new Set(state.routes.map(route => route.key));
    for (const key of reported.current) if (!active.has(key)) reported.current.delete(key);
    for (const route of state.routes) {
      if (reported.current.has(route.key)) continue;
      reported.current.add(route.key);
      telemetry.screen(route.name, route.params ?? {});
    }
  }
  if (session.status === 'loading' && upgrade?.status === 'error') return <AppRecoveryScreen t={t} retryStart={retryStart}/>;
  if (session.status === 'loading') return <View testID="app-startup-surface" style={{flex: 1, backgroundColor: C.background}} />;
  return <ObserveNavigationContainer ref={setObserveNavigationRef} onReady={() => {reportRoutes(); systemEntry?.setNavigator(bookmarkId => navigationRef.dispatch(StackActions.push('Reader', {bookmarkId})));}} onStateChange={reportRoutes}>
    <Stack.Navigator screenOptions={{headerTintColor: C.text, headerStyle: {backgroundColor: C.background}, headerTitleAlign: 'center', headerTitleStyle: {fontSize: 17, fontWeight: '500'}, contentStyle: {backgroundColor: C.background}, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal'}}>
      {session.status === 'unauthenticated' ? <Stack.Screen name="Login" getComponent={screens.Login} options={{headerShown: false}}/> : <Stack.Group navigationKey={session.session.userId}>
        <Stack.Screen name="Library" getComponent={screens.Library} options={{headerShown: false}}/>
        <Stack.Screen name="Search" getComponent={screens.Search} options={{title: t('search_action'), headerStyle: {backgroundColor: C.readerBackground}}}/>
        <Stack.Screen name="Reader" getComponent={screens.Reader} options={readerScreenOptions}/>
        <Stack.Screen name="Settings" getComponent={screens.Settings} options={{title: t('setting_title'), headerTitle: sourceHeaderTitle}}/>
        <Stack.Screen name="About" getComponent={screens.About} options={{title: t('sidebar_about')}}/>
        <Stack.Screen name="Debug" getComponent={screens.Debug} options={{title: 'Debug'}}/>
        <Stack.Screen name="DiagnosticLog" getComponent={screens.DiagnosticLog} options={{title: t('diagnostic_logs')}}/>
        <Stack.Screen name="DeleteAccount" getComponent={screens.DeleteAccount} options={{title: t('setting_delete_account')}}/>
        <Stack.Screen name="Subscription" getComponent={screens.Subscription} options={{title: 'Pro Reader', headerTitleStyle: {fontSize: 20, fontWeight: '500'}}}/>
        <Stack.Screen name="Feedback" getComponent={screens.Feedback} options={{title: t('sidebar_feedback'), headerTitle: sourceHeaderTitle}}/>
      </Stack.Group>}
    </Stack.Navigator>
  </ObserveNavigationContainer>;
}

class RuntimeBoundary extends React.Component<{children: React.ReactNode}, {error: Error|null}> {
  state: {error: Error|null} = {error: null};
  static getDerivedStateFromError(error: Error) { return {error}; }
  render() {
    return this.state.error ? <SafeAreaView style={styles.center}><Text style={styles.title}>Unable to start Slax Reader</Text><Text style={styles.message}>{this.state.error.message}</Text></SafeAreaView> : this.props.children;
  }
}
function App() {
  return <GestureHandlerRootView style={{flex: 1}}><SafeAreaProvider><StatusBar barStyle="dark-content"/>
    <RuntimeBoundary><MobileProvider appIntents={AppIntents}><ApplicationRoutes/></MobileProvider></RuntimeBoundary>
  </SafeAreaProvider></GestureHandlerRootView>;
}
export default ObserveRoot.wrap(App);
const styles = StyleSheet.create({center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: C.background}, title: {fontSize: 18, color: C.text, textAlign: 'center'}, message: {fontSize: 14, lineHeight: 21, color: C.secondaryText, textAlign: 'center', marginTop: 16}});
