import React, {useEffect, useRef} from 'react';
import {Platform, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {NavigationContainer, createNavigationContainerRef} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {MobileProvider, useMobile} from './runtime';
import {mobileColors as C} from './theme';
import type {RootStackParams} from './navigation/types';
import {LoginScreen} from './screens/LoginScreen';
import {LibraryScreen} from './screens/LibraryScreen';
import {ReaderScreen} from './screens/ReaderScreen';
import {SettingsScreen} from './screens/SettingsScreen';
import {AboutScreen} from './screens/AboutScreen';
import {FeedbackScreen} from './screens/FeedbackScreen';
import {DeleteAccountScreen} from './screens/DeleteAccountScreen';
import {SubscriptionScreen} from './screens/SubscriptionScreen';
import {DebugScreen} from './screens/DebugScreen';
import {useTelemetry} from './telemetry';
import {SourceLine} from './components/SourceLine';

const Stack = createNativeStackNavigator<RootStackParams>();
export const navigationRef = createNavigationContainerRef<RootStackParams>();

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
  const {session, t} = useMobile();
  const telemetry = useTelemetry();
  const reported = useRef(new Set<string>());
  const userId = session.status === 'authenticated' ? session.session.userId : null;
  useEffect(() => { telemetry.identify(userId); }, [telemetry, userId]);
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
  if (session.status === 'loading') return <View testID="app-startup-surface" style={{flex: 1, backgroundColor: C.background}} />;
  return <NavigationContainer ref={navigationRef} onReady={reportRoutes} onStateChange={reportRoutes}>
    <Stack.Navigator screenOptions={{headerTintColor: C.text, headerStyle: {backgroundColor: C.background}, headerTitleAlign: 'center', headerTitleStyle: {fontSize: 17, fontWeight: '500'}, contentStyle: {backgroundColor: C.background}, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal'}}>
      {session.status === 'unauthenticated' ? <Stack.Screen name="Login" component={LoginScreen} options={{headerShown: false}}/> : <Stack.Group navigationKey={session.session.userId}>
        <Stack.Screen name="Library" component={LibraryScreen} options={{headerShown: false}}/>
        <Stack.Screen name="Reader" component={ReaderScreen} options={{title: '', headerStyle: {backgroundColor: C.readerBackground}}}/>
        <Stack.Screen name="Settings" component={SettingsScreen} options={{title: t('setting_title'), headerTitle: sourceHeaderTitle}}/>
        <Stack.Screen name="About" component={AboutScreen} options={{title: t('sidebar_about')}}/>
        <Stack.Screen name="Debug" component={DebugScreen} options={{title: 'Debug'}}/>
        <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} options={{title: t('setting_delete_account')}}/>
        <Stack.Screen name="Subscription" component={SubscriptionScreen} options={{title: 'Pro Reader', headerTitleStyle: {fontSize: 20, fontWeight: '500'}}}/>
        <Stack.Screen name="Feedback" component={FeedbackScreen} options={{title: t('sidebar_feedback'), headerTitle: sourceHeaderTitle}}/>
      </Stack.Group>}
    </Stack.Navigator>
  </NavigationContainer>;
}

class RuntimeBoundary extends React.Component<{children: React.ReactNode}, {error: Error|null}> {
  state: {error: Error|null} = {error: null};
  static getDerivedStateFromError(error: Error) { return {error}; }
  render() {
    return this.state.error ? <SafeAreaView style={styles.center}><Text style={styles.title}>Unable to start Slax Reader</Text><Text style={styles.message}>{this.state.error.message}</Text></SafeAreaView> : this.props.children;
  }
}
export default function App() {
  return <GestureHandlerRootView style={{flex: 1}}><SafeAreaProvider><StatusBar barStyle="dark-content"/>
    <RuntimeBoundary><MobileProvider><ApplicationRoutes/></MobileProvider></RuntimeBoundary>
  </SafeAreaProvider></GestureHandlerRootView>;
}
const styles = StyleSheet.create({center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: C.background}, title: {fontSize: 18, color: C.text, textAlign: 'center'}, message: {fontSize: 14, lineHeight: 21, color: C.secondaryText, textAlign: 'center', marginTop: 16}});
