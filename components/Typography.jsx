import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { COLORS } from '../constants/theme';

export const Headline = ({ children, style, ...props }) => (
  <Text style={[styles.headline, style]} {...props}>
    {children}
  </Text>
);

export const Body = ({ children, style, ...props }) => (
  <Text style={[styles.body, style]} {...props}>
    {children}
  </Text>
);

const styles = StyleSheet.create({
  headline: {
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    lineHeight: 40,
    color: COLORS.primary,
    letterSpacing: 0,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.secondary,
  },
});
