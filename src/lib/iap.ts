import Constants from "expo-constants";
import { Platform } from "react-native";

import { TIP_PRODUCTS } from "../constants";

export const TIP_SKUS = TIP_PRODUCTS.map((item) => item.id);

export function isIapAvailable(): boolean {
  if (Platform.OS === "web") return false;
  if (Constants.appOwnership === "expo") return false;
  return true;
}
