import { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Colors } from '../constants/colors';

// ⭐ THE ONE PHOTO VIEWER (2026-11-05, the user: "Yes, I agree" — one
// universal viewer; memory project_download_progress_ui, "UNIVERSAL VIEWER").
// It draws ONLY the photo area. Every screen keeps its own Modal, header
// (counter, buttons), footer text and covers — ⛔ the user, 2026-11-05: no
// button and no text may change in any lightbox.
//
// What it does, and the protected rules it keeps (protected item 5):
//  - The current photo AND its neighbours are drawn, so the next photo is
//    already there when you swipe.
//  - The photo uses the whole area (contain), not a fixed box.
//  - Sideways: the photo moves WITH the finger and the next one slides in.
//    Released past 50 px → that photo; less → springs back (50 px, distance
//    only, as decided). Past the first / last photo it only stretches a little.
//  - The direction is decided ONCE, on the first ~10 px of movement, and kept
//    for the rest of the gesture — never per frame.
//  - Zoom: pinch, or double-tap (2.5×). While zoomed EVERYTHING is gated on the
//    saved zoom: a drag moves inside the photo and never changes photo or
//    closes.
//  - Swipe down to close: the photo follows the finger and fades; past 100 px
//    or a fast flick it closes, otherwise it springs back. Never while `busy`
//    (a download, share, delete or restore in flight) — each screen passes its
//    own busy flag, mirrored into a shared value the gestures can read.
//  - Zoom, position and the close drag reset whenever the photo changes and
//    each time the viewer opens (it is mounted fresh on every open).
//  - The ‹ › arrows are drawn HERE, for every viewer (2026-11-05, the user:
//    "1. Yes. 2. Yes" — the Recycle bin had none because the arrows had been
//    left in each screen). Same look as the screens' old lbArrow / lbArrowText;
//    hidden at the first / last photo and while the current photo loads; a
//    tap slides to the neighbour.

type Props<T> = {
  items: T[];
  index: number;
  getKey: (item: T) => string;
  getUri: (item: T) => string | null | undefined;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  busy?: boolean;
  // Told true when the current photo is still loading, false once it is shown —
  // so a screen keeps its own rules (e.g. the ‹ › arrows hidden while loading).
  onLoadingChange?: (loading: boolean) => void;
};

const SLIDE_MS = 220;
const WINDOW = 2; // photos drawn on each side of the current one

function Slide({ uri, width, onLoaded }: { uri: string | null | undefined; width: number; onLoaded: () => void }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); }, [uri]);
  return (
    <View style={{ width, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width, height: '100%' }}
          contentFit="contain"
          cachePolicy="memory-disk"
          onLoad={() => { setLoaded(true); onLoaded(); }}
        />
      ) : null}
      {(!uri || !loaded) && <ActivityIndicator color={Colors.accent} style={StyleSheet.absoluteFill} />}
    </View>
  );
}

export default function PhotoViewer<T>({ items, index, getKey, getUri, onIndexChange, onClose, busy = false, onLoadingChange }: Props<T>) {
  const { width: W } = useWindowDimensions();

  const stripX = useSharedValue(-index * W);
  const indexSV = useSharedValue(index);
  const countSV = useSharedValue(items.length);
  const busySV = useSharedValue(busy ? 1 : 0);
  // The direction lock (protected item 5): decided ONCE on the first ~10 px.
  const dragAxis = useSharedValue(0); // 0 undecided, 1 sideways, 2 down
  const dropY = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const savedPanX = useSharedValue(0);
  const savedPanY = useSharedValue(0);

  // A photo change that came from our own swipe: the strip is already there.
  const ownChange = useRef(false);
  // Which photos have finished loading (by key), and which one is current.
  const loadedKeys = useRef(new Set<string>());
  const currentKey = items[index] ? getKey(items[index]) : null;
  const currentKeyRef = useRef(currentKey);
  currentKeyRef.current = currentKey;
  const onLoadingChangeRef = useRef(onLoadingChange);
  onLoadingChangeRef.current = onLoadingChange;
  // Whether the current photo is still loading — hides the ‹ › arrows.
  const [currentLoading, setCurrentLoading] = useState(true);
  const reportLoading = (loading: boolean) => {
    setCurrentLoading(loading);
    onLoadingChangeRef.current?.(loading);
  };

  useEffect(() => { busySV.value = busy ? 1 : 0; }, [busy, busySV]);
  useEffect(() => { countSV.value = items.length; }, [items.length, countSV]);

  // Photo changed (swipe, arrows, a photo removed) → put the strip there and
  // reset zoom / position / close drag.
  useEffect(() => {
    indexSV.value = index;
    const target = -index * W;
    if (ownChange.current) {
      ownChange.current = false;
      stripX.value = target;
    } else {
      stripX.value = withTiming(target, { duration: SLIDE_MS });
    }
    scale.value = 1;
    savedScale.value = 1;
    panX.value = 0;
    panY.value = 0;
    savedPanX.value = 0;
    savedPanY.value = 0;
    dropY.value = 0;
    dragAxis.value = 0;
    const item = items[index];
    const ready = !!item && !!getUri(item) && loadedKeys.current.has(getKey(item));
    reportLoading(!ready);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, W]);

  const commit = (next: number) => {
    ownChange.current = true;
    onIndexChange(next);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 5));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < 1.05) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        panX.value = withSpring(0);
        panY.value = withSpring(0);
        savedPanX.value = 0;
        savedPanY.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onBegin(() => {
      dragAxis.value = 0;
    })
    .onUpdate((e) => {
      if (savedScale.value > 1) {
        panX.value = savedPanX.value + e.translationX;
        panY.value = savedPanY.value + e.translationY;
        return;
      }
      if (dragAxis.value === 0 && (Math.abs(e.translationX) > 10 || Math.abs(e.translationY) > 10)) {
        dragAxis.value = Math.abs(e.translationY) > Math.abs(e.translationX) ? 2 : 1;
      }
      if (dragAxis.value === 1) {
        const i = indexSV.value;
        let dx = e.translationX;
        if ((i === 0 && dx > 0) || (i === countSV.value - 1 && dx < 0)) dx = dx * 0.3;
        stripX.value = -i * W + dx;
      } else if (dragAxis.value === 2 && e.translationY > 0 && busySV.value === 0) {
        dropY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (savedScale.value > 1) {
        savedPanX.value = panX.value;
        savedPanY.value = panY.value;
        return;
      }
      if (dragAxis.value === 2) {
        if (busySV.value === 0 && (e.translationY > 100 || (e.translationY > 20 && e.velocityY > 800))) {
          runOnJS(onClose)();
          return;
        }
        dropY.value = withSpring(0);
        return;
      }
      if (dragAxis.value === 1) {
        const i = indexSV.value;
        let next = i;
        if (Math.abs(e.translationX) > 50 && Math.abs(e.translationX) > Math.abs(e.translationY)) {
          next = e.translationX < 0 ? i + 1 : i - 1;
        }
        if (next < 0 || next >= countSV.value) next = i;
        indexSV.value = next;
        stripX.value = withTiming(-next * W, { duration: SLIDE_MS }, (finished) => {
          if (finished && next !== i) runOnJS(commit)(next);
        });
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd(() => {
      if (savedScale.value > 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        panX.value = withSpring(0);
        panY.value = withSpring(0);
        savedPanX.value = 0;
        savedPanY.value = 0;
      } else {
        scale.value = withSpring(2.5);
        savedScale.value = 2.5;
      }
    });

  const gesture = Gesture.Simultaneous(doubleTap, pan, pinch);

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: stripX.value }] }));
  const currentStyle = useAnimatedStyle(() => ({
    // Fades as it is dragged down, so the gesture shows its own progress and
    // can be abandoned. Never while zoomed — the drag is panning then.
    opacity: savedScale.value > 1 ? 1 : Math.max(0.35, 1 - Math.max(0, dropY.value) / 400),
    transform: [
      { translateX: panX.value },
      { translateY: panY.value + dropY.value },
      { scale: scale.value },
    ],
  }));

  const first = Math.max(0, index - WINDOW);
  const last = Math.min(items.length - 1, index + WINDOW);
  const shown: number[] = [];
  for (let i = first; i <= last; i++) shown.push(i);

  return (
    <View style={styles.area}>
    <GestureDetector gesture={gesture}>
      <Animated.View style={StyleSheet.absoluteFill} collapsable={false}>
        <Animated.View style={[StyleSheet.absoluteFill, stripStyle]}>
          {shown.map(i => {
            const item = items[i];
            return (
              <Animated.View
                key={getKey(item)}
                style={[styles.page, { left: i * W, width: W }, i === index ? currentStyle : null]}
              >
                <Slide
                  uri={getUri(item)}
                  width={W}
                  onLoaded={() => {
                    const key = getKey(item);
                    loadedKeys.current.add(key);
                    if (key === currentKeyRef.current) reportLoading(false);
                  }}
                />
              </Animated.View>
            );
          })}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
      {index > 0 && !currentLoading && (
        <TouchableOpacity style={[styles.arrow, { left: 0 }]} onPress={() => onIndexChange(index - 1)}>
          <Text style={styles.arrowText}>‹</Text>
        </TouchableOpacity>
      )}
      {index < items.length - 1 && !currentLoading && (
        <TouchableOpacity style={[styles.arrow, { right: 0 }]} onPress={() => onIndexChange(index + 1)}>
          <Text style={styles.arrowText}>›</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // ⛔ FULL WIDTH whatever box it sits in (fixed 2026-11-05: inside the three
  // screens' centring box, lbImgWrap alignItems 'center', the viewer got a
  // width of 0 — every child is absolutely positioned — and showed nothing).
  // ⛔ Photos are NEVER cropped (the user, 2026-11-05: "I do not want to crop
  // any photo in the lightbox view") — every photo uses contentFit 'contain'.
  area: { flex: 1, alignSelf: 'stretch', width: '100%', overflow: 'hidden' },
  page: { position: 'absolute', top: 0, bottom: 0 },
  // Same as the screens' old lbArrow / lbArrowText (app/event.tsx styles).
  arrow: { position: 'absolute', top: 0, bottom: 0, width: 50, justifyContent: 'center', alignItems: 'center' },
  arrowText: { fontSize: 36, color: 'rgba(255,255,255,0.35)' },
});
