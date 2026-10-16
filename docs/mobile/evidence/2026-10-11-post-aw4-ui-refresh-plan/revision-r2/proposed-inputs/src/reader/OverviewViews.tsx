import React, {useState} from 'react'
import {Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions} from 'react-native'
import {SourceIcon, SourceText} from '../components'

/** Source OverviewView: omit empty results and append the source arrow to the excerpt. */
export function OverviewExcerpt({content, prefix, onPress}: {content: string; prefix: string; onPress(): void}) {
  if (!content) return null
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.excerpt}>
    <SourceText numberOfLines={3} style={styles.excerptText}><SourceText style={{color: '#999999'}}>{prefix}</SourceText>{content}{' '}<SourceIcon name="ic_xs_blue_down_arrow" size={8} /></SourceText>
  </Pressable>
}

/** Original OverviewDialog uses a full opaque surface, a centered card and an external close icon. */
export function OverviewDialog({visible, content, takeaways, title, closeLabel, onClose}: {visible: boolean; content: string; takeaways: string[]; title: string; closeLabel: string; onClose(): void}) {
  const {height} = useWindowDimensions()
  const [contentHeight, setContentHeight] = useState(0)
  const cardHeight = Math.min(contentHeight || height * .8, height * .8)
  const top = (height - cardHeight) / 2
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <View style={styles.modal}>
      <Pressable accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={[styles.card, {top, height: cardHeight}]} testID="reader-overview-dialog">
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.contents} onLayout={event => setContentHeight(event.nativeEvent.layout.height)}>
            <SourceText style={styles.title}>{title}</SourceText>
            {content ? <SourceText selectable style={styles.summary}>{content}</SourceText> : null}
            {takeaways.length ? <View style={{marginTop: 14}}>{takeaways.map((text, index) => <View key={index} style={styles.takeaway}>
              <View style={styles.timeline}>
                {index > 0 ? <View style={[styles.timelineLine, {top: 0, bottom: '50%', marginBottom: 7}]} /> : null}
                {index < takeaways.length - 1 ? <View style={[styles.timelineLine, {top: '50%', bottom: 0, marginTop: 7}]} /> : null}
                <View style={styles.dot} />
              </View>
              <SourceText style={styles.takeawayText}>{text}</SourceText>
            </View>)}</View> : null}
          </View>
        </ScrollView>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} hitSlop={8} style={[styles.close, {top: top + cardHeight + 34}]}><SourceIcon name="ic_circle_close_icon" size={24} /></Pressable>
    </View>
  </Modal>
}

const styles = StyleSheet.create({
  excerpt: {marginTop: 20, backgroundColor: '#F5F5F3', borderRadius: 8, padding: 12},
  excerptText: {fontSize: 14, lineHeight: 20, color: '#333333', fontWeight: '400', includeFontPadding: false},
  modal: {flex: 1, backgroundColor: '#F5F5F3'},
  card: {position: 'absolute', left: 20, right: 20, backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden'},
  contents: {paddingVertical: 24, paddingHorizontal: 20},
  title: {fontSize: 14, lineHeight: 20, color: '#999999', includeFontPadding: false},
  summary: {marginTop: 20, fontSize: 16, lineHeight: 27, color: '#333333', includeFontPadding: false},
  takeaway: {flexDirection: 'row', alignItems: 'stretch'},
  timeline: {width: 6, justifyContent: 'center', alignItems: 'center'},
  timelineLine: {position: 'absolute', width: 1, backgroundColor: '#33333314'},
  dot: {width: 6, height: 6, backgroundColor: '#F5F5F3CC', borderWidth: 1.26, borderColor: '#D3D3D3', borderRadius: 3},
  takeawayText: {flex: 1, paddingLeft: 12, paddingVertical: 6, fontSize: 14, lineHeight: 20, color: '#333333CC', includeFontPadding: false},
  close: {position: 'absolute', alignSelf: 'center', width: 24, height: 24},
})
