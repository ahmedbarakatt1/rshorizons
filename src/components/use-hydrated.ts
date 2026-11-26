"use client";

import {useSyncExternalStore} from "react";

// React reads the server snapshot until it has attached the component's event handlers.
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function useHydrated() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
