import React from "react";
import { StyleSheet, Text } from "react-native";
import { COLORS } from "../constants/theme";
import { GlassModal, ModalAction } from "./GlassModal";

const TERMS_MESSAGE =
  "By using TechKnow, you agree to our Terms and Conditions, which cover account responsibility, proper use of services, purchases and transactions, intellectual property rights, privacy practices, limitation of liability, possible amendments, and governing law under the Philippines. Reservations are first-come, first-served and are not guaranteed until the store accepts them. TechKnow does not process or cover payments inside the app and does not guarantee product availability, pricing, reservation acceptance, pickup, or fulfillment. Problems involving a store, product, reservation, payment, cancellation, delay, or external transaction must be addressed directly with the store; TechKnow is not responsible or liable for losses, scams, fraud, or other issues arising from those matters.";

export const TermsModal = ({ visible, onClose, onAgree }) => (
  <GlassModal visible={visible} onClose={onClose} title="Terms and Conditions"
    icon="verified-user" showClose
    footer={<ModalAction title="I Agree" onPress={onAgree} />}>
    {TERMS_MESSAGE.split(". ").map((paragraph, index, paragraphs) => (
      <Text key={index} style={styles.paragraph}>
        {paragraph}{index < paragraphs.length - 1 ? "." : ""}
      </Text>
    ))}
  </GlassModal>
);

const styles = StyleSheet.create({
  paragraph: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 23,
    color: COLORS.textDim, marginBottom: 14 },
});
