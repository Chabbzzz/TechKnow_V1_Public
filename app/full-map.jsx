import React from "react";
import { useLocalSearchParams } from "expo-router";
import { NearbyShopsView } from "../components/NearbyShopsView";

export default function FullMapScreen() {
  const params = useLocalSearchParams();
  return <NearbyShopsView expanded initialStoreId={typeof params.storeId === "string" ? params.storeId : null}
    returnTo={params.returnTo === "/search" ? "/search" : "/nearby"} />;
}
