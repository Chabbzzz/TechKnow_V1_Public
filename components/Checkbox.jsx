import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS, SIZES } from '../constants/theme';

export const Checkbox = ({ label, checked, onChange, style }) => {
  return (
    <TouchableOpacity 
      style={[styles.container, style]} 
      onPress={() => onChange(!checked)}
      activeOpacity={0.8}
    >
      <MaterialIcons 
        name={checked ? "check-box" : "check-box-outline-blank"} 
        size={24} 
        color={checked ? COLORS.primary : COLORS.outline} 
      />
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    marginLeft: SIZES.sm,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: COLORS.secondary,
    flex: 1,
  },
});
