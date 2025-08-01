"use client";
import { useSyncExternalStore } from "react"
import { getMediaQueryStore } from "@/lib/getMediaQueryStore"

/**
 * Hook to check if the screen is mobile
 * u/param breakpoint - The breakpoint to check against
 * u/returns true if the screen is mobile, false otherwise
 */
export function useIsMobile(breakpoint = 768) {
  const store = getMediaQueryStore(breakpoint)

  return useSyncExternalStore(
    (cb) => {
      store.subscribers.add(cb)
      return () => store.subscribers.delete(cb)
    },
    () => store.isMatch,
    () => false
  )
}