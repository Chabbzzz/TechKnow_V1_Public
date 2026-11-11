import React from "react";
import { useLocalSearchParams } from "expo-router";
import { NearbyShopsView } from "../components/NearbyShopsView";

export default function NearbyScreen() {
  const params = useLocalSearchParams();
  return <NearbyShopsView returnTo={params.returnTo === "/home" ? "/home" : "/search"} />;
}
