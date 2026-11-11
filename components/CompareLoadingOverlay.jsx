import React from "react";
import { GlassModal } from "./GlassModal";

export function CompareLoadingOverlay({
  visible,
  title = "Opening comparison...",
  message = "Loading the product details for you.",
}) {
  return <GlassModal visible={visible} title={title} message={message} busy />;
}
