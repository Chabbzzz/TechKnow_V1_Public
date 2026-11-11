import React, { useEffect, useRef, useState } from "react";
import { Image } from "react-native";
import { getDownloadURL, ref } from "firebase/storage";
import { storage } from "../backend/firebase";

/**
 * Renders a product image from its saved download URL. When a storage path is
 * also available, it can recover the download URL through the native Firebase
 * SDK if the stored URL is unavailable or no longer valid.
 */
export function ProductImage({
  uri = "",
  storagePath = "",
  fallback = null,
  ...imageProps
}) {
  const normalizedUri = typeof uri === "string" ? uri.trim() : "";
  const normalizedStoragePath = typeof storagePath === "string" ? storagePath.trim() : "";
  const directUri = /^(https?:|data:image\/|file:|content:|asset:)/i.test(normalizedUri)
    ? normalizedUri
    : "";
  const resolvedStoragePath = normalizedStoragePath || (normalizedUri && !directUri ? normalizedUri : "");
  const [sourceUri, setSourceUri] = useState(directUri);
  const [imageFailed, setImageFailed] = useState(false);
  const triedStoragePath = useRef(false);

  useEffect(() => {
    let isCurrent = true;
    setSourceUri(directUri);
    setImageFailed(false);
    triedStoragePath.current = false;

    if (!directUri && resolvedStoragePath) {
      getDownloadURL(ref(storage, resolvedStoragePath))
        .then((downloadUrl) => {
          if (isCurrent) setSourceUri(downloadUrl);
        })
        .catch((error) => {
          if (!isCurrent) return;
          console.warn("Product image could not be resolved from Storage", error);
          setImageFailed(true);
        });
    }

    return () => {
      isCurrent = false;
    };
  }, [directUri, resolvedStoragePath]);

  const handleImageError = () => {
    if (resolvedStoragePath && !triedStoragePath.current) {
      triedStoragePath.current = true;
      getDownloadURL(ref(storage, resolvedStoragePath))
        .then((downloadUrl) => {
          setImageFailed(false);
          setSourceUri(downloadUrl);
        })
        .catch((error) => {
          console.warn("Product image could not be loaded", error);
          setImageFailed(true);
        });
      return;
    }

    setImageFailed(true);
  };

  if (!sourceUri || imageFailed) return fallback;

  return (
    <Image
      {...imageProps}
      source={{ uri: sourceUri }}
      onError={handleImageError}
    />
  );
}
