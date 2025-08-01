/*  Shared Media-Query Store                                          */

type MediaQueryStore = {
  /** Latest match result (true / false) */
  isMatch: boolean
  /** The native MediaQueryList object */
  mediaQueryList: MediaQueryList
  /** React subscribers that need re-rendering on change */
  subscribers: Set<() => void>
}

/** Map of raw query strings -> singleton store objects */
const mediaQueryStores: Record<string, MediaQueryStore> = {}

/**
 * getMediaQueryStore("(max-width: 768px)")
 * Returns a singleton store for that query,
 * creating it (and its listener) the first time.
 */
export function getMediaQueryStore(breakpoint: number): MediaQueryStore {
  // Already created? - just return it
  if (mediaQueryStores[breakpoint]) return mediaQueryStores[breakpoint]

  // --- First-time setup ---
  const queryString = `(max-width: ${breakpoint - 0.1}px)`
  const mqList = typeof window !== "undefined" ? window.matchMedia(queryString) : ({} as MediaQueryList)

  const store: MediaQueryStore = {
    isMatch: typeof window !== "undefined" ? mqList.matches : false,
    mediaQueryList: mqList,
    subscribers: new Set(),
  }

  const update = () => {
    console.log("update: ", mqList.matches)
    store.isMatch = mqList.matches
    store.subscribers.forEach((cb) => cb())
  }

  if (mqList.addEventListener) mqList.addEventListener("change", update)
  // for Safari < 14
  else if (mqList.addListener) mqList.addListener(update)

  mediaQueryStores[breakpoint] = store
  return store
}

