import type {ViewInstance} from 'react-native'
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PixelRatio, Pressable, StyleSheet, View } from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Reanimated, {cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming} from 'react-native-reanimated';
import {motionDuration} from '../motion/policy';
import {useReducedMotion} from '../motion/useReducedMotion';
import {useDrawerGesture} from './SourceDrawer';
import * as Haptics from 'expo-haptics';
import { bookmarkDisplayTitle, type BookmarkRecord } from '../data/repositories';
import type {MobileContextValue} from '../runtime';
import type {MobileTelemetry} from '../telemetry/core';
import { mobileColors as C, mobileLayout as L } from '../theme';
import { mobileTestIds as IDs } from '../theme/testIds';
import { SourceIcon } from './SourceUI';
import {SourceLine} from './SourceLine';
import { SourceMenu } from './SourceMenu';

export type LibrarySort = 'inbox' | 'starred' | 'archived';
type BookmarkRowProps = {item: BookmarkRecord; sort: LibrarySort; owned: boolean; onOpen(item: BookmarkRecord): void; onEdit(item: BookmarkRecord): void; onError(error: unknown): void; t: MobileContextValue['t']; repositories: MobileContextValue['repositories']; telemetry: MobileTelemetry};
export const BookmarkRow = memo(function BookmarkRow({item, sort, owned, onOpen, onEdit, onError, t, repositories, telemetry}: BookmarkRowProps) {
  const drawerGesture = useDrawerGesture(), reducedMotion = useReducedMotion();
  const offset = useSharedValue(0), dragStart = useSharedValue(0), dragging = useSharedValue(false), touchX = useSharedValue(0), touchY = useSharedValue(0);
  const generation = useSharedValue(0);
  const flash = useRef(new Animated.Value(0)).current, title = bookmarkDisplayTitle(item), oldTitle = useRef(title);
  const row = useRef<ViewInstance>(null), [menu, setMenu] = useState(false), [anchor, setAnchor] = useState({x: 0, y: 0});
  const menuMounted = useRef(false);
  if (menu) menuMounted.current = true;
  const max = owned ? sort === 'inbox' ? 130 : 70 : 0;
  useEffect(() => {
    generation.value++; cancelAnimation(offset); offset.value = 0; dragging.value = false;
    return () => {generation.value++; cancelAnimation(offset);};
  }, [item.id, max, offset, dragging, generation]);
  useEffect(() => {
    if (oldTitle.current === title) return;
    oldTitle.current = title;
    if (reducedMotion) return;
    const animation = Animated.sequence(Array.from({length: 3}, () => [Animated.timing(flash, {toValue: 0.05, duration: motionDuration.titlePulse, useNativeDriver: true}), Animated.timing(flash, {toValue: 0, duration: motionDuration.titlePulse, useNativeDriver: true})]).flat());
    animation.start();
    return () => {animation.stop(); flash.setValue(0);};
  }, [item.id, title, flash, reducedMotion]);
  const settleOffset = React.useCallback((next: number) => {
    'worklet';
    const owner = ++generation.value;
    cancelAnimation(offset);
    offset.value = withTiming(next, {duration: motionDuration.rowSettle, easing: Easing.inOut(Easing.ease), reduceMotion: ReduceMotion.System}, finished => {
      if (finished && generation.value === owner) dragging.value = false;
    });
  }, [offset, dragging, generation]);
  const pan = useMemo(() => {
    const gesture = Gesture.Pan().enabled(owned && !menu).manualActivation(true)
      .onTouchesDown(event => {const touch = event.allTouches[0]; if (touch) {touchX.value = touch.absoluteX; touchY.value = touch.absoluteY;} dragging.value = false;})
      .onTouchesMove((event, manager) => {
        if (dragging.value) return;
        const touch = event.allTouches[0]; if (!touch) return;
        const dx = touch.absoluteX - touchX.value, dy = touch.absoluteY - touchY.value;
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {manager.fail(); return;}
        if (Math.abs(dx) <= 8 || Math.abs(dx) <= Math.abs(dy)) return;
        if (dx > 0 && offset.value >= 0) manager.fail(); else manager.activate();
      })
      .onStart(() => {generation.value++; cancelAnimation(offset); dragStart.value = offset.value; dragging.value = true;})
      .onUpdate(event => {offset.value = Math.max(-max, Math.min(0, dragStart.value + event.translationX));})
      .onEnd((_event, succeeded) => {
        if (!succeeded) return;
        const closing = offset.value > dragStart.value;
        settleOffset(Math.abs(offset.value) >= max * (closing ? 0.8 : 0.4) ? -max : 0);
      })
      .onFinalize((_event, succeeded) => {if (dragging.value && !succeeded) settleOffset(0);});
    if (drawerGesture) gesture.blocksExternalGesture(drawerGesture);
    return gesture;
  }, [owned, menu, max, offset, dragStart, dragging, touchX, touchY, drawerGesture, generation, settleOffset]);
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withSpring(menu ? 1 : 0, {damping: 18, stiffness: 260, reduceMotion: ReduceMotion.System});
    return () => cancelAnimation(lift);
  }, [menu, lift]);
  const rowStyle = useAnimatedStyle(() => ({transform: [{translateX: offset.value}, {scale: 1 + lift.value * 0.05}], backgroundColor: C.readerBackground,
    shadowColor: '#000000', shadowOpacity: lift.value * 0.14, shadowRadius: lift.value * 12, shadowOffset: {width: 0, height: 4}, elevation: lift.value * 8}));
  function settle() {settleOffset(0);}
  function perform(work: () => Promise<unknown> | undefined, elementId: string, swipe = false) {settle(); const operation = work(); if (!operation) return; void operation.then(() => {telemetry.element(elementId, 'bookmarks'); if (swipe) telemetry.firebase('bookmark_list', 'item_interact', {element: elementId === 'bookmark_star_button' ? 'star' : 'archive', source: 'inbox'});}).catch(onError);}
  const state = item.downloadStatus === 1 ? 'DOWNLOADING' : item.downloadStatus === 2 ? 'COMPLETED' : item.downloadStatus === 3 ? 'FAILED' : 'NONE';
  const statusIcon = sort === 'starred' ? 'ic_cell_starred' : sort === 'archived' ? 'ic_cell_archived' : item.downloadStatus === 1 ? 'ic_cell_internet_downloading' : item.downloadStatus === 2 ? 'ic_cell_internet' : 'ic_cell_internet_uncached';
  return <View ref={row} style={styles.container}>
    {owned ? <View style={styles.actions}>
      {sort !== 'archived' ? <Pressable accessibilityRole="button" accessibilityLabel={t(item.isStarred ? 'bookmark_unstar' : 'bookmark_star')} onPress={() => perform(() => repositories?.updateBookmark(item.id, {isStarred: item.isStarred ? 0 : 1}), 'bookmark_star_button', true)} style={[styles.action, {backgroundColor: '#FFB648'}]}><SourceIcon name={item.isStarred ? 'ic_cell_action_starred' : 'ic_cell_action_star'} size={20} /></Pressable> : null}
      {sort !== 'starred' ? <Pressable accessibilityRole="button" accessibilityLabel={t(item.archiveStatus ? 'bookmark_unarchive' : 'bookmark_archive')} onPress={() => perform(() => repositories?.updateBookmark(item.id, {archiveStatus: item.archiveStatus ? 0 : 1}), 'bookmark_archive_button', true)} style={[styles.action, {backgroundColor: C.bodyText}]}><SourceIcon name={item.archiveStatus ? 'ic_cell_action_archieved' : 'ic_cell_action_archieve'} size={20} /></Pressable> : null}
    </View> : null}
    <GestureDetector gesture={pan}><Reanimated.View style={rowStyle}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={() => {if (dragging.value) return; if (offset.value) settle(); else {if (owned && item.status === 'success') telemetry.element('bookmark_list_row', 'bookmarks'); onOpen(item);}}}
        onLongPress={owned ? () => {if (dragging.value) return; void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); row.current?.measureInWindow((x, y, width) => {setAnchor({x: x + width - 188, y: y + 38}); setMenu(true);});} : undefined}
        style={({pressed}) => [styles.row, {backgroundColor: pressed ? '#0000000D' : C.readerBackground}]}>
        <View style={styles.status}><SourceIcon name={statusIcon} size={12} label={`Article · ${state}`} testID={IDs.BookmarkItemStatus} /></View>
        <SourceLine text={title} fontSize={16} lineHeight={24} color={C.text} style={{flex: 1, alignSelf: 'center'}} />
      </Pressable>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {backgroundColor: '#000000', opacity: flash}]} />
    </Reanimated.View></GestureDetector>
    {owned && menuMounted.current ? <SourceMenu visible={menu} width={180} anchor={anchor} onDismiss={() => setMenu(false)} items={[
      {label: t(item.isStarred ? 'bookmark_unstar' : 'bookmark_star'), icon: item.isStarred ? 'ic_floating_panel_starred' : 'ic_cell_more_star', onPress: () => perform(() => repositories?.updateBookmark(item.id, {isStarred: item.isStarred ? 0 : 1}), 'bookmark_star_button')},
      {label: t(item.archiveStatus ? 'bookmark_unarchive' : 'bookmark_archive'), icon: item.archiveStatus ? 'ic_floating_panel_archieved' : 'ic_cell_more_archieve', onPress: () => perform(() => repositories?.updateBookmark(item.id, {archiveStatus: item.archiveStatus ? 0 : 1}), 'bookmark_archive_button')},
      {label: t('bookmark_edit_title'), icon: 'ic_cell_more_edittitle', onPress: () => {onEdit(item); telemetry.element('bookmark_edit_title_button', 'bookmarks');}},
      {label: t('bookmark_delete'), icon: 'ic_cell_more_delete', color: C.danger, onPress: () => perform(() => repositories?.deleteBookmark(item.id), 'bookmark_delete_button')},
    ]} /> : null}
  </View>;
});
const styles = StyleSheet.create({container: {height: PixelRatio.roundToNearestPixel(L.librarySwipeActionHeight), backgroundColor: C.readerBackground}, row: {height: PixelRatio.roundToNearestPixel(L.librarySwipeActionHeight), flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: L.libraryRowStartInset, paddingRight: L.libraryRowEndInset}, status: {width: 18, height: 18, borderRadius: 9, backgroundColor: C.background, justifyContent: 'center', alignItems: 'center'}, actions: {position: 'absolute', right: 18, top: 0, bottom: 0, flexDirection: 'row', gap: 12, alignItems: 'center'}, action: {width: 40, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center'}});
