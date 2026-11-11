import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { WebView } from "react-native-webview";
import { scriptJson } from "../constants/store-map-document";

export const MapSurface = forwardRef(function MapSurface({ html, onMessage, onError }, ref) {
  const web = useRef(null);
  useImperativeHandle(ref, () => ({ send: payload => web.current?.injectJavaScript(
    `window.receiveStoreMap && window.receiveStoreMap(${scriptJson(payload)}); true;`
  ) }), []);
  return <WebView ref={web} source={{ html }} style={{ flex: 1, backgroundColor: "transparent" }}
    originWhitelist={["*"]} javaScriptEnabled domStorageEnabled scrollEnabled={false}
    onMessage={event => onMessage(event.nativeEvent.data)} onError={onError}
    onHttpError={onError} setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
    onOpenWindow={() => {}}
    onShouldStartLoadWithRequest={request => request.url === "about:blank" || request.url.startsWith("data:")}
  />;
});
