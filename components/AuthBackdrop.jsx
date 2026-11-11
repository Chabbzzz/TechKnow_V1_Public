import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../constants/theme';

export function AuthBackdrop() {
  return (
    <LinearGradient pointerEvents="none" colors={['#EAF1FC', COLORS.background, COLORS.background]}
      locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
  );
}
