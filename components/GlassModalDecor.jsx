import React from "react";
import { StyleSheet, View } from "react-native";

export function GlassModalDecor() {
  return (
    <>
      <View pointerEvents="none" style={[styles.orb, styles.blueOrb]} />
      <View pointerEvents="none" style={[styles.orb, styles.greenOrb]} />
      <View pointerEvents="none" style={styles.topHighlight} />
    </>
  );
}

const styles = StyleSheet.create({
  orb: {
    position: "absolute",
    borderRadius: 999,
  },
  blueOrb: {
    width: 230,
    height: 230,
    top: -105,
    right: -80,
    backgroundColor: "rgba(56, 143, 255, 0.2)",
  },
  greenOrb: {
    width: 190,
    height: 190,
    bottom: -95,
    left: -70,
    backgroundColor: "rgba(44, 204, 157, 0.16)",
  },
  topHighlight: {
    position: "absolute",
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
  },
});
