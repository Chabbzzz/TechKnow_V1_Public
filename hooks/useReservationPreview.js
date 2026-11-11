import { useCallback, useRef, useState } from "react";
import { router } from "expo-router";
import { toReservationParams } from "../constants/products";

export function useReservationPreview(defaultReturnTo = "/home") {
  const [product, setProduct] = useState(null);
  const [visible, setVisible] = useState(false);
  const destination = useRef(null);
  const returnTo = useRef(defaultReturnTo);
  const continuing = useRef(false);

  const openReservation = useCallback((selectedProduct, target = defaultReturnTo) => {
    if (!selectedProduct || continuing.current) return;
    destination.current = null;
    returnTo.current = target;
    setProduct(selectedProduct);
    setVisible(true);
  }, [defaultReturnTo]);

  const closePreview = () => {
    if (continuing.current) return;
    destination.current = null;
    setVisible(false);
  };

  const continueToReservation = () => {
    if (!product || continuing.current) return;
    continuing.current = true;
    destination.current = toReservationParams(product, returnTo.current);
    setVisible(false);
  };

  const finishPreview = () => {
    const params = destination.current;
    destination.current = null;
    continuing.current = false;
    setProduct(null);
    if (params) router.push({ pathname: "/reservation", params });
  };

  return {
    reservationPreviewProps: {
      visible,
      product,
      onClose: closePreview,
      onContinue: continueToReservation,
      onAfterClose: finishPreview,
      showKeepComparing: false,
    },
    openReservation,
  };
}
