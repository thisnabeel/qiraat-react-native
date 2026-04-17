import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ScrollView, View } from "react-native";

/**
 * Minimal web stand-in for react-native-pager-view so Expo web export can bundle.
 * Matches the props/refs used in App.js (horizontal paging, inverted indices).
 */
const PagerViewWeb = forwardRef(function PagerViewWeb(
  { style, initialPage = 0, onPageSelected, children },
  ref
) {
  const scrollRef = useRef(null);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const pendingIndexRef = useRef(null);
  const didInitialScrollRef = useRef(false);

  const scrollToIndex = useCallback(
    (index, animated) => {
      const w = layoutWidth;
      if (!scrollRef.current || w <= 0) {
        pendingIndexRef.current = index;
        return;
      }
      scrollRef.current.scrollTo({ x: index * w, animated });
    },
    [layoutWidth]
  );

  useImperativeHandle(
    ref,
    () => ({
      setPage: (index) => scrollToIndex(index, true),
      setPageWithoutAnimation: (index) => scrollToIndex(index, false),
    }),
    [scrollToIndex]
  );

  const flushPending = useCallback(() => {
    const w = layoutWidth;
    if (w <= 0 || pendingIndexRef.current == null || !scrollRef.current) return;
    const index = pendingIndexRef.current;
    pendingIndexRef.current = null;
    scrollRef.current.scrollTo({ x: index * w, animated: false });
  }, [layoutWidth]);

  useEffect(() => {
    flushPending();
  }, [flushPending]);

  // Match native PagerView: initialPage is only applied on first layout, not on every prop update.
  useEffect(() => {
    if (didInitialScrollRef.current || layoutWidth <= 0 || !scrollRef.current) return;
    didInitialScrollRef.current = true;
    scrollRef.current.scrollTo({
      x: initialPage * layoutWidth,
      animated: false,
    });
  }, [initialPage, layoutWidth]);

  const onLayout = useCallback(
    (e) => {
      const w = e.nativeEvent.layout.width;
      if (w > 0 && w !== layoutWidth) {
        setLayoutWidth(w);
      }
    },
    [layoutWidth]
  );

  const onMomentumScrollEnd = useCallback(
    (e) => {
      const w = layoutWidth;
      if (w <= 0) return;
      const x = e.nativeEvent.contentOffset?.x ?? 0;
      const position = Math.round(x / w);
      onPageSelected?.({ nativeEvent: { position } });
    },
    [layoutWidth, onPageSelected]
  );

  return (
    <View style={style} onLayout={onLayout}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={onMomentumScrollEnd}
        onScrollEndDrag={onMomentumScrollEnd}
      >
        {React.Children.map(children, (child, i) => (
          <View
            key={i}
            style={{
              width: layoutWidth > 0 ? layoutWidth : "100%",
              flex: 1,
            }}
          >
            {child}
          </View>
        ))}
      </ScrollView>
    </View>
  );
});

export default PagerViewWeb;
