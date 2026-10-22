import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import type {MobileAssetName} from '../../assets';
import {mobileColors as C} from '../theme';
import {SourceIcon} from './SourceUI';

export type BookmarkDownloadStatus = 'NONE' | 'DOWNLOADING' | 'COMPLETED' | 'FAILED';
export type BookmarkStatusSort = 'inbox' | 'starred' | 'archived';
/** A download shorter than this is presented directly as cached instead of flashing the clock. */
export const bookmarkDownloadDelay = 250;
/** Once shown, the clock stays readable even when the download finishes immediately after. */
export const bookmarkDownloadMinimum = 450;

export function bookmarkDownloadStatus(value: number): BookmarkDownloadStatus {
  return value === 1 ? 'DOWNLOADING' : value === 2 ? 'COMPLETED' : value === 3 ? 'FAILED' : 'NONE';
}

export function bookmarkStatusIcon(status: BookmarkDownloadStatus, sort: BookmarkStatusSort): MobileAssetName {
  if (sort === 'starred') return 'ic_cell_starred';
  if (sort === 'archived') return 'ic_cell_archived';
  return status === 'DOWNLOADING' ? 'ic_cell_internet_downloading' : status === 'COMPLETED' ? 'ic_cell_internet' : 'ic_cell_internet_uncached';
}

/** Keeps one row's status glyph stable while several automatic caches write concurrently. */
export function BookmarkStatusIcon({status, sort, label, testID}: {status: BookmarkDownloadStatus; sort: BookmarkStatusSort; label: string; testID?: string}) {
  const [displayed, setDisplayed] = useState<BookmarkDownloadStatus>(status);
  const shownAt = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (status === displayed) return;
    if (status === 'DOWNLOADING') {
      timer.current = setTimeout(() => { shownAt.current = Date.now(); setDisplayed('DOWNLOADING'); }, bookmarkDownloadDelay);
    } else if (displayed === 'DOWNLOADING') {
      timer.current = setTimeout(() => setDisplayed(status), Math.max(0, bookmarkDownloadMinimum - (Date.now() - shownAt.current)));
    } else setDisplayed(status);
    return () => {if (timer.current) {clearTimeout(timer.current); timer.current = null;}};
  }, [status, displayed]);
  return <View style={styles.status}><SourceIcon name={bookmarkStatusIcon(displayed, sort)} size={12} label={label} testID={testID} /></View>;
}

const styles = StyleSheet.create({status: {width: 18, height: 18, borderRadius: 9, backgroundColor: C.background, justifyContent: 'center', alignItems: 'center'}});
