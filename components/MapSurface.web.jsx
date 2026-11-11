import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";

export const MapSurface = forwardRef(function MapSurface({ html, onMessage, onError }, ref) {
  const frame = useRef(null);
  // A blob document retains the app origin for the Leaflet map and its assets.
  const source = useMemo(() => URL.createObjectURL(new Blob([html], { type: "text/html" })), [html]);
  useEffect(() => () => URL.revokeObjectURL(source), [source]);
  useImperativeHandle(ref, () => ({ send: payload => frame.current?.contentWindow?.postMessage(
    { channel: "techknow-map-host", payload }, "*"
  ) }), []);
  useEffect(() => {
    const receive = event => { if (event.source === frame.current?.contentWindow) onMessage(event.data); };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onMessage]);
  return <iframe ref={frame} title="Interactive store map" src={source} sandbox="allow-scripts allow-same-origin"
    onError={onError} style={{ border: 0, width: "100%", height: "100%", flex: 1 }} />;
});
