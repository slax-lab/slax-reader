import type {ViewInstance} from 'react-native'
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PixelRatio, Pressable, StyleSheet, View } from 'react-native';
import {GestureDetector, usePanGesture} from 'react-native-gesture-handler';
import Reanimated, {cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming} from 'react-native-reanimated';
import {scheduleOnRN} from 'react-native-worklets';
import {motionDuration} from '../motion/policy';
import {useReducedMotion} from '../motion/useReducedMotion';
import * as Haptics from 'expo-haptics';
import { bookmarkDisplayTitle, type LibraryBookmark } from '../data/repositories';
import type {MobileContextValue} from '../runtime';
import type {MobileTelemetry} from '../telemetry/core';
import { mobileColors as C, mobileLayout as L } from '../theme';
import { mobileTestIds as IDs } from '../theme/testIds';
import { SourceIcon } from './SourceUI';
import {SourceLine} from './SourceLine';
import { SourceMenu } from './SourceMenu';
import {BookmarkStatusIcon, bookmarkDownloadStatus} from './BookmarkStatusIcon';

export type LibrarySort = 'inbox' | 'starred' | 'archived';
/** Reveal at 40% from closed, keep revealed above 80% from open; a 400pt/s fling decides by direction. */
export function rowRevealed(offset: number, start: number, velocity: number, max: number): boolean {
  'worklet';
  if (Math.abs(velocity) >= 400) return velocity < 0;
  return Math.abs(offset) >= max * (offset > start ? 0.8 : 0.4);
}
const neverFail = Number.MAX_SAFE_INTEGER, closedFail = 5;
function thresholdTick() {void Haptics.selectionAsync();}
type BookmarkRowProps = {item: LibraryBookmark; sort: LibrarySort; owned: boolean; onOpen(item: LibraryBookmark): void; onEdit(item: LibraryBookmark): void; onError(error: unknown): void; t: MobileContextValue['t']; repositories: MobileContextValue['repositories']; telemetry: MobileTelemetry};
export const BookmarkRow = memo(function BookmarkRow({item, sort, owned, onOpen, onEdit, onError, t, repositories, telemetry}: BookmarkRowProps) {
  const reducedMotion = useReducedMotion();
  const offset = useSharedValue(0), dragStart = useSharedValue(0), armed = useSharedValue(false), lift = useSharedValue(0);
  const [flash] = useState(() => new Animated.Value(0)), title = bookmarkDisplayTitle(item), oldTitle = useRef(title), [flashing, setFlashing] = useState(0);
  const row = useRef<ViewInstance>(null), [menu, setMenu] = useState(false), [anchor, setAnchor] = useState({x: 0, y: 0});
  // At rest a row is plain views: actions mount for a drag or reveal, and the swipe fail offset is a constant, not a shared-value binding.
  const [lifted, setLifted] = useState(false), [revealed, setRevealed] = useState(false), [showActions, setShowActions] = useState(false);
  const menuMounted = useRef(false), engaged = useRef(false);
  if (menu) menuMounted.current = true;
  if (revealed || showActions) engaged.current = true;
  const max = owned ? sort === 'inbox' ? 130 : 70 : 0;
  const resetKey = useRef({id: item.id, max});
  useEffect(() => {
    if (resetKey.current.id === item.id && resetKey.current.max === max) return;
    resetKey.current = {id: item.id, max};
    cancelAnimation(offset); offset.value = 0; setRevealed(false); setShowActions(false);
  }, [item.id, max, offset]);
  useEffect(() => () => {if (engaged.current) cancelAnimation(offset);}, [offset]);
  useEffect(() => {
    if (oldTitle.current === title) return;
    oldTitle.current = title;
    if (reducedMotion) {setFlashing(0); return;}
    setFlashing(value => value + 1);
  }, [title, reducedMotion]);
  const flashActive = flashing > 0 && !reducedMotion;
  useEffect(() => {
    if (!flashActive) return;
    const animation = Animated.sequence(Array.from({length: 3}, () => [Animated.timing(flash, {toValue: 0.05, duration: motionDuration.titlePulse, useNativeDriver: true}), Animated.timing(flash, {toValue: 0, duration: motionDuration.titlePulse, useNativeDriver: true})]).flat());
    animation.start(({finished}) => {if (finished) setFlashing(0);});
    return () => {animation.stop(); flash.setValue(0);};
  }, [flashing, flashActive, flash]);
  useEffect(() => {if (reducedMotion) setFlashing(0);}, [reducedMotion]);
  const settleOffset = React.useCallback((next: number) => {
    'worklet';
    // A closed row yields any rightward drag to the drawer or the list; a revealed row may be dragged closed.
    scheduleOnRN(setRevealed, next < 0);
    cancelAnimation(offset);
    offset.value = withTiming(next, {duration: motionDuration.rowSettle, easing: Easing.inOut(Easing.ease), reduceMotion: ReduceMotion.System}, finished => {if (finished && next === 0) scheduleOnRN(setShowActions, false);});
  }, [offset]);
  const pan = usePanGesture(useMemo(() => ({
    enabled: owned && !menu, activeOffsetX: [-10, 10] as [number, number], failOffsetX: revealed ? neverFail : closedFail, failOffsetY: [-10, 10] as [number, number],
    onActivate: () => {'worklet'; cancelAnimation(offset); dragStart.value = offset.value; armed.value = rowRevealed(offset.value, offset.value, 0, max); scheduleOnRN(setShowActions, true);},
    onUpdate: (event: {translationX: number}) => {
      'worklet';
      offset.value = Math.max(-max, Math.min(0, dragStart.value + event.translationX));
      const next = rowRevealed(offset.value, dragStart.value, 0, max);
      if (next !== armed.value) {armed.value = next; scheduleOnRN(thresholdTick);}
    },
    onDeactivate: (event: {velocityX?: number; canceled: boolean}) => {
      'worklet';
      settleOffset(!event.canceled && rowRevealed(offset.value, dragStart.value, event.velocityX ?? 0, max) ? -max : 0);
    },
  }), [owned, menu, max, revealed, offset, dragStart, armed, settleOffset]));
  useEffect(() => {
    if (menu) setLifted(true);
    else if (!menuMounted.current) return;
    lift.value = withSpring(menu ? 1 : 0, {damping: 18, stiffness: 260, reduceMotion: ReduceMotion.System}, finished => {if (finished && !menu) scheduleOnRN(setLifted, false);});
    return () => cancelAnimation(lift);
  }, [menu, lift]);
  // One mapper per row; the lift inputs are read only while the menu is mounted.
  const surfaceStyle = useAnimatedStyle(() => lifted
    ? {transform: [{translateX: offset.value}, {scale: 1 + lift.value * 0.05}], shadowOpacity: lift.value * 0.14, shadowRadius: lift.value * 12, elevation: lift.value * 8}
    : {transform: [{translateX: offset.value}]}, [lifted]);
  function settle() {engaged.current = true; settleOffset(0);}
  function perform(work: () => Promise<unknown> | undefined, elementId: string, swipe = false) {settle(); const operation = work(); if (!operation) return; void operation.then(() => {telemetry.element(elementId, 'bookmarks'); if (swipe) telemetry.firebase('bookmark_list', 'item_interact', {element: elementId === 'bookmark_star_button' ? 'star' : 'archive', source: 'inbox'});}).catch(onError);}
  const toggleStar = (swipe: boolean) => perform(() => repositories?.updateBookmark(item.id, {isStarred: item.isStarred ? 0 : 1}), 'bookmark_star_button', swipe);
  const toggleArchive = (swipe: boolean) => perform(() => repositories?.updateBookmark(item.id, {archiveStatus: item.archiveStatus ? 0 : 1}), 'bookmark_archive_button', swipe);
  const starLabel = t(item.isStarred ? 'bookmark_unstar' : 'bookmark_star'), archiveLabel = t(item.archiveStatus ? 'bookmark_unarchive' : 'bookmark_archive');
  // The swipe actions stay reachable by assistive technology while their buttons are not mounted.
  const accessibilityActions = useMemo(() => owned ? [...(sort !== 'archived' ? [{name: 'star', label: starLabel}] : []), ...(sort !== 'starred' ? [{name: 'archive', label: archiveLabel}] : [])] : undefined, [owned, sort, starLabel, archiveLabel]);
  const state = bookmarkDownloadStatus(item.downloadStatus);
  return <View ref={row} style={styles.container}>
    {owned && showActions ? <View style={styles.actions}>
      {sort !== 'archived' ? <Pressable accessibilityRole="button" accessibilityLabel={starLabel} onPress={() => toggleStar(true)} style={[styles.action, {backgroundColor: '#FFB648'}]}><SourceIcon name={item.isStarred ? 'ic_cell_action_starred' : 'ic_cell_action_star'} size={20} /></Pressable> : null}
      {sort !== 'starred' ? <Pressable accessibilityRole="button" accessibilityLabel={archiveLabel} onPress={() => toggleArchive(true)} style={[styles.action, {backgroundColor: C.bodyText}]}><SourceIcon name={item.archiveStatus ? 'ic_cell_action_archieved' : 'ic_cell_action_archieve'} size={20} /></Pressable> : null}
    </View> : null}
    <GestureDetector gesture={pan}><Reanimated.View style={[lifted ? styles.lift : styles.surface, surfaceStyle]}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityActions={accessibilityActions} onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'star') toggleStar(false); else if (event.nativeEvent.actionName === 'archive') toggleArchive(false);}}
        onPress={() => {if (revealed) settle(); else {if (owned && item.status === 'success') telemetry.element('bookmark_list_row', 'bookmarks'); onOpen(item);}}}
        onLongPress={owned ? () => {settle(); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); row.current?.measureInWindow((x, y, width) => {setAnchor({x: x + width - 188, y: y + 38}); setMenu(true);});} : undefined}
        style={({pressed}) => [styles.row, {backgroundColor: pressed ? '#0000000D' : C.readerBackground}]}>
        <BookmarkStatusIcon status={state} sort={sort} label={`Article · ${state}`} testID={IDs.BookmarkItemStatus} />
        <SourceLine text={title} fontSize={16} lineHeight={24} color={C.text} style={{flex: 1, alignSelf: 'center'}} />
      </Pressable>
      {flashActive ? <Animated.View testID="bookmark-row-title-flash" pointerEvents="none" style={[StyleSheet.absoluteFill, {backgroundColor: '#000000', opacity: flash}]} /> : null}
    </Reanimated.View></GestureDetector>
    {owned && menuMounted.current ? <SourceMenu visible={menu} width={180} anchor={anchor} onDismiss={() => setMenu(false)} items={[
      {label: starLabel, icon: item.isStarred ? 'ic_floating_panel_starred' : 'ic_cell_more_star', onPress: () => toggleStar(false)},
      {label: archiveLabel, icon: item.archiveStatus ? 'ic_floating_panel_archieved' : 'ic_cell_more_archieve', onPress: () => toggleArchive(false)},
      {label: t('bookmark_edit_title'), icon: 'ic_cell_more_edittitle', onPress: () => {onEdit(item); telemetry.element('bookmark_edit_title_button', 'bookmarks');}},
      {label: t('bookmark_delete'), icon: 'ic_cell_more_delete', color: C.danger, onPress: () => perform(() => repositories?.deleteBookmark(item.id), 'bookmark_delete_button')},
    ]} /> : null}
  </View>;
});
const styles = StyleSheet.create({surface: {backgroundColor: C.readerBackground}, lift: {backgroundColor: C.readerBackground, shadowColor: '#000000', shadowOffset: {width: 0, height: 4}}, container: {height: PixelRatio.roundToNearestPixel(L.librarySwipeActionHeight), backgroundColor: C.readerBackground}, row: {height: PixelRatio.roundToNearestPixel(L.librarySwipeActionHeight), flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: L.libraryRowStartInset, paddingRight: L.libraryRowEndInset}, actions: {position: 'absolute', right: 18, top: 0, bottom: 0, flexDirection: 'row', gap: 12, alignItems: 'center'}, action: {width: 40, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center'}});
