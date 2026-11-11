import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Keyboard, View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { useProductNotifications } from '../hooks/useProductNotifications';

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: 'home-outline', activeIcon: 'home', route: '/home' },
  { id: 'search', label: 'Search', icon: 'search-outline', activeIcon: 'search', route: '/search' },
  { id: 'reserve', label: 'Reserve', icon: 'bag-handle-outline', activeIcon: 'bag-handle', route: '/reservation' },
  { id: 'alerts', label: 'Alerts', icon: 'notifications-outline', activeIcon: 'notifications', route: '/notifications' },
  { id: 'profile', label: 'Profile', icon: 'person-circle-outline', activeIcon: 'person-circle', route: '/profile' },
];

const ROUTE_TABS = {
  '/home': 'home',
  '/search': 'search',
  '/nearby': 'search',
  '/compare': 'search',
  '/reservation': 'reserve',
  '/reservation-history': 'reserve',
  '/notifications': 'alerts',
  '/profile': 'profile',
  '/reviews': 'profile',
  '/favorites': 'profile',
};

function NavItem({ item, selected, unreadCount, reducedMotion, onPress }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) scale.setValue(1);
    return () => scale.stopAnimation();
  }, [reducedMotion, scale]);

  const animatePress = (pressed) => {
    if (reducedMotion) return;
    Animated.spring(scale, {
      toValue: pressed ? 0.94 : 1,
      damping: 24,
      stiffness: 400,
      mass: 0.6,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={item.id === 'alerts' && unreadCount > 0
        ? `Alerts, ${unreadCount} unread notifications` : item.label}
      accessibilityState={{ selected }}
      aria-selected={selected}
      onPress={onPress}
      onPressIn={() => animatePress(true)}
      onPressOut={() => animatePress(false)}
      style={styles.item}
    >
      <Animated.View style={[styles.itemContent, { transform: [{ scale }] }]}>
        <View style={styles.icon}>
          <Ionicons name={selected ? item.activeIcon : item.icon} size={24}
            color={selected ? COLORS.tabActive : COLORS.tabIcon} />
          {item.id === 'alerts' && unreadCount > 0 && (
            <View style={styles.badge}>
              <Text maxFontSizeMultiplier={1.2} style={styles.badgeText}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          )}
        </View>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3}
          style={[styles.label, selected && styles.selectedLabel]}>
          {item.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// Mounted once beside the navigator, so screen transitions never animate the dock.
// Screens with this bar leave their bottom safe-area inset to it.
export const BottomNav = ({ reducedMotion = true }) => {
  const pathname = usePathname();
  const active = ROUTE_TABS[pathname];
  const activeIndex = NAV_ITEMS.findIndex(item => item.id === active);
  const insets = useSafeAreaInsets();
  const { unreadCount } = useProductNotifications();
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());
  const [rowWidth, setRowWidth] = useState(0);
  const indicatorX = useRef(new Animated.Value(0)).current;
  const previousWidth = useRef(0);
  const pendingRoute = useRef(null);
  const itemWidth = Math.max(0, (rowWidth - 2 * (NAV_ITEMS.length - 1)) / NAV_ITEMS.length);

  useEffect(() => { pendingRoute.current = null; }, [pathname]);

  useEffect(() => {
    // iOS announces the keyboard before it opens; Android emits didShow only.
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true),
    );
    // Wait until dismissal completes so the dock never appears above a closing keyboard.
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useLayoutEffect(() => {
    if (activeIndex < 0 || keyboardVisible || !rowWidth) {
      previousWidth.current = 0;
      return;
    }
    const toValue = activeIndex * (itemWidth + 2);
    // Set the first position and resized layouts directly; animate tab changes only.
    if (reducedMotion || previousWidth.current !== rowWidth) {
      indicatorX.setValue(toValue);
    } else {
      Animated.spring(indicatorX, {
        toValue,
        damping: 28,
        stiffness: 320,
        mass: 0.8,
        overshootClamping: true,
        useNativeDriver: true,
      }).start();
    }
    previousWidth.current = rowWidth;
    return () => indicatorX.stopAnimation();
  }, [activeIndex, keyboardVisible, itemWidth, rowWidth, reducedMotion, indicatorX]);

  if (activeIndex < 0 || keyboardVisible) return null;

  const navigate = (route) => {
    if (pathname === route || pendingRoute.current === route) return;
    pendingRoute.current = route;
    Keyboard.dismiss();
    router.replace(route);
  };

  return (
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.shadow}>
        <View style={styles.container}>
          {Platform.OS === 'ios' && (
            <BlurView
              pointerEvents="none"
              tint="systemChromeMaterialLight"
              intensity={80}
              style={StyleSheet.absoluteFill}
            />
          )}
          <View style={styles.row} onLayout={event => setRowWidth(event.nativeEvent.layout.width)}>
            {rowWidth > 0 && (
              <Animated.View pointerEvents="none" testID="bottom-nav-indicator"
                style={[styles.indicator, { width: itemWidth, transform: [{ translateX: indicatorX }] }]} />
            )}
            {NAV_ITEMS.map(item => (
              <NavItem key={item.id} item={item} selected={item.id === active}
                unreadCount={unreadCount} reducedMotion={reducedMotion}
                onPress={() => navigate(item.route)} />
            ))}
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  dock: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: COLORS.background,
  },
  shadow: {
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
    borderRadius: 34,
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.72)' : COLORS.surface,
    shadowColor: '#172B4D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  container: {
    padding: 5,
    borderRadius: 34,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 2 },
  indicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 28,
    borderCurve: 'continuous',
    backgroundColor: '#EAF0FA',
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 54,
    paddingHorizontal: 2,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    borderCurve: 'continuous',
  },
  itemContent: { alignItems: 'center', justifyContent: 'center', gap: 2, width: '100%' },
  icon: { width: 32, height: 28, alignItems: 'center', justifyContent: 'center' },
  label: {
    ...Platform.select({
      ios: { fontWeight: '500' },
      default: { fontFamily: 'Inter_500Medium' },
    }),
    fontSize: 10.5,
    lineHeight: 14,
    textAlign: 'center',
    color: COLORS.tabIcon,
    includeFontPadding: false,
  },
  selectedLabel: {
    ...Platform.select({
      ios: { fontWeight: '600' },
      default: { fontFamily: 'Inter_600SemiBold' },
    }),
    color: COLORS.tabActive,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -7,
    minWidth: 18,
    minHeight: 18,
    borderRadius: 10,
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: COLORS.surface,
    backgroundColor: '#D92D3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: COLORS.white,
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    lineHeight: 12,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
});
