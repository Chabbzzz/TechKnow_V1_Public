import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Keyboard, Modal, Pressable,
  Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { BlurTargetView, BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { useReducedMotion } from '../hooks/useReducedMotion';

const TONES = {
  primary: { color: COLORS.primary, fill: 'rgba(220,234,255,0.76)' },
  success: { color: '#137e54', fill: 'rgba(212,244,229,0.76)' },
  danger: { color: COLORS.error, fill: 'rgba(255,224,230,0.78)' },
};

const ModalAppearance = createContext({ isAlert: false, stackedActions: false });

export function ModalAction({ title, onPress, secondary = false, danger = false, disabled = false, divider = false }) {
  const { isAlert, stackedActions } = useContext(ModalAppearance);
  return (
    <Pressable accessibilityRole="button" aria-disabled={disabled} disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, secondary && styles.secondaryAction,
        danger && !secondary && styles.dangerAction,
        isAlert && styles.alertAction, isAlert && stackedActions && styles.stackedAlertAction,
        isAlert && divider && (stackedActions ? styles.alertHorizontalDivider : styles.alertVerticalDivider),
        pressed && (isAlert ? styles.alertPressed : styles.pressed), disabled && styles.disabled]}>
      <Text style={[styles.actionText, secondary && styles.secondaryActionText,
        isAlert && styles.alertActionText, isAlert && secondary && styles.alertCancelText,
        isAlert && danger && styles.alertDangerText]}>{title}</Text>
    </Pressable>
  );
}

/** Consistent mobile dialog presented in its own native window on every route. */
export function GlassModal({
  visible, onClose, onAfterClose, title, message, icon = 'info-outline', tone = 'primary',
  busy = false, spinnerOnly = false, dismissOnBackdrop = false, showClose = false, children, footer,
  variant = 'glass', alertIcon = 'information-circle-outline', showIcon = true, backdropColor,
  actionLayout = 'auto',
}) {
  const [presented, setPresented] = useState(Boolean(visible));
  const progress = useRef(new Animated.Value(0)).current;
  const blurTarget = useRef(null);
  const hasOpened = useRef(false);
  const afterCloseRef = useRef(onAfterClose);
  afterCloseRef.current = onAfterClose;
  const reducedMotion = useReducedMotion();
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const accent = TONES[tone] || TONES.primary;
  const isAlert = variant === 'alert';
  const stackedActions = isAlert && (actionLayout === 'stacked' || fontScale > 1.3);

  useEffect(() => {
    if (visible) {
      Keyboard.dismiss();
      setPresented(true);
    }
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reducedMotion ? 0 : visible ? 200 : 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setPresented(false);
    });
    return () => animation.stop();
  }, [visible, progress, reducedMotion]);

  useEffect(() => {
    if (presented) hasOpened.current = true;
    else if (hasOpened.current && !visible) {
      hasOpened.current = false;
      afterCloseRef.current?.();
    }
  }, [presented, visible]);

  const dismiss = busy ? undefined : onClose;
  return (
    <Modal visible={presented} transparent animationType="none" presentationStyle="overFullScreen"
      statusBarTranslucent navigationBarTranslucent hardwareAccelerated
      onRequestClose={dismiss || (() => {})}>
      <Animated.View style={[styles.overlay, { opacity: progress,
        paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        {spinnerOnly ? (
          <View accessibilityViewIsModal
            style={[styles.spinnerOverlay, backdropColor && { backgroundColor: backdropColor }]}>
            <ActivityIndicator size="large" color={accent.color} accessibilityLabel="Opening reservation" />
          </View>
        ) : <>
        {isAlert ? <View pointerEvents="none"
          style={[styles.alertBackdrop, backdropColor && { backgroundColor: backdropColor }]} /> : (
          <BlurTargetView ref={blurTarget} pointerEvents="none" style={StyleSheet.absoluteFill}
            collapsable={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[styles.backdrop, backdropColor && { backgroundColor: backdropColor }]} />
            <LinearGradient colors={['rgba(113,164,239,0.20)', 'rgba(91,139,219,0.08)', 'rgba(93,186,171,0.18)']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          </BlurTargetView>
        )}
        <Pressable style={StyleSheet.absoluteFill} accessible={false}
          onPress={dismissOnBackdrop ? dismiss : undefined} />
        <Animated.View accessibilityViewIsModal onAccessibilityEscape={dismiss}
          role={isAlert ? 'alertdialog' : undefined} aria-label={isAlert ? title : undefined}
          aria-modal={isAlert ? true : undefined}
          style={[styles.shadow, isAlert && styles.alertShadow,
            { maxHeight: Math.max(120, height - insets.top - insets.bottom - 48),
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [reducedMotion ? 0 : 12, 0] }) },
              { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [reducedMotion ? 1 : 0.97, 1] }) },
            ] }]}>
          <ModalAppearance.Provider value={{ isAlert, stackedActions }}>
            <View style={[styles.card, isAlert && styles.alertCard]}>
              {isAlert ? (
                Platform.OS === 'ios' ? <BlurView pointerEvents="none" intensity={80}
                  tint="systemMaterialLight" style={StyleSheet.absoluteFill} /> : null
              ) : (
                <>
                  <BlurView pointerEvents="none" blurTarget={blurTarget}
                    blurMethod="dimezisBlurViewSdk31Plus"
                    intensity={75} blurReductionFactor={3} tint="systemUltraThinMaterialLight"
                    style={StyleSheet.absoluteFill} />
                  <LinearGradient pointerEvents="none"
                    colors={['rgba(255,255,255,0.42)', 'rgba(248,251,255,0.26)', 'rgba(229,242,255,0.34)']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  <View pointerEvents="none" style={styles.reflection} />
                </>
              )}
              {showClose && dismiss ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Close dialog" onPress={dismiss}
                  style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
                  <MaterialIcons name="close" size={20} color={COLORS.textDim} />
                </Pressable>
              ) : null}
              <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, isAlert && styles.alertBody]}
                keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
                {showIcon ? <View style={[styles.icon, isAlert && styles.alertIcon, { backgroundColor: accent.fill }]}>
                  {busy ? <ActivityIndicator size="large" color={accent.color} accessibilityLabel="Loading" />
                    : isAlert ? <Ionicons name={alertIcon} size={24} color={accent.color} />
                      : <MaterialIcons name={icon} size={26} color={accent.color} />}
                </View> : null}
                <Text accessibilityRole="header" style={[styles.title, isAlert && styles.alertTitle]}>{title}</Text>
                {message ? <Text style={[styles.message, isAlert && styles.alertMessage]}>{message}</Text> : null}
                {children ? <View style={styles.children}>{children}</View> : null}
              </ScrollView>
              {footer ? <View style={[styles.footer, isAlert && styles.alertFooter,
                stackedActions && styles.stackedAlertFooter]}>{footer}</View> : null}
            </View>
          </ModalAppearance.Provider>
        </Animated.View>
        </>}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  spinnerOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,25,43,0.48)' },
  shadow: { width: '100%', maxWidth: 400, flexShrink: 1, borderRadius: 26,
    shadowColor: '#0a1930', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.2, shadowRadius: 28, elevation: 18 },
  card: { flexShrink: 1, overflow: 'hidden', borderRadius: 26, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.84)', backgroundColor: 'rgba(248,251,255,0.28)' },
  reflection: { position: 'absolute', top: 0, left: 22, right: 22, height: 1,
    backgroundColor: 'rgba(255,255,255,0.96)' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 22, alignItems: 'center' },
  icon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.92)', marginBottom: 16 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 21, lineHeight: 28, color: '#17263d', textAlign: 'center' },
  message: { marginTop: 9, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 22,
    color: '#344761', textAlign: 'center' },
  children: { width: '100%', marginTop: 20 },
  footer: { paddingHorizontal: 24, paddingBottom: 24, gap: 10, flexShrink: 0 },
  close: { position: 'absolute', top: 7, right: 7, width: 44, height: 44, zIndex: 2,
    alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  action: { minHeight: 48, borderRadius: 14, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  actionText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  secondaryAction: { backgroundColor: 'rgba(255,255,255,0.66)', borderColor: 'rgba(130,153,185,0.32)' },
  secondaryActionText: { color: '#344761' },
  dangerAction: { backgroundColor: COLORS.error },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
  alertBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,20,30,0.34)' },
  alertShadow: { maxWidth: 320, borderRadius: 24, shadowColor: '#101828',
    shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.14, shadowRadius: 24, elevation: 12 },
  alertCard: { borderRadius: 24, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: Platform.OS === 'ios' ? 'rgba(250,251,253,0.94)' : '#FAFBFD' },
  alertBody: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 22 },
  alertIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 0, marginBottom: 12 },
  alertTitle: {
    ...Platform.select({ ios: { fontFamily: undefined, fontWeight: '600' }, default: { fontFamily: 'Inter_600SemiBold' } }),
    fontSize: 18, lineHeight: 24, color: COLORS.text,
  },
  alertMessage: {
    ...Platform.select({ ios: { fontFamily: undefined, fontWeight: '400' }, default: { fontFamily: 'Inter_400Regular' } }),
    marginTop: 6, fontSize: 13, lineHeight: 19, color: COLORS.textDim,
  },
  alertFooter: { flexDirection: 'row', paddingHorizontal: 0, paddingBottom: 0, gap: 0,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D8DDE5' },
  stackedAlertFooter: { flexDirection: 'column' },
  alertAction: { flex: 1, minWidth: 0, minHeight: 52, borderRadius: 0, borderWidth: 0,
    backgroundColor: 'transparent', paddingHorizontal: 12, paddingVertical: 14 },
  stackedAlertAction: { flex: 0, width: '100%' },
  alertActionText: {
    ...Platform.select({ ios: { fontFamily: undefined, fontWeight: '500' }, default: { fontFamily: 'Inter_500Medium' } }),
    fontSize: 16, lineHeight: 22, color: COLORS.primary,
  },
  alertCancelText: {
    ...Platform.select({ ios: { fontWeight: '600' }, default: { fontFamily: 'Inter_600SemiBold' } }),
  },
  alertDangerText: { color: COLORS.error },
  alertVerticalDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: '#D8DDE5' },
  alertHorizontalDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D8DDE5' },
  alertPressed: { backgroundColor: 'rgba(29,45,68,0.07)' },
});
