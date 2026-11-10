/**
 * The service worker (vite-plugin-pwa, 'prompt' mode): registered only on the app page, in
 * production builds. When a new version has been downloaded, the app shows "A new version of
 * PlainSpice is ready" with a Reload button instead of reloading on its own (a reload must never
 * interrupt typing); the first time the app is ready offline, it says so once.
 */
export interface PwaEvents {
  onNeedRefresh: (update: () => void) => void;
  onOfflineReady: () => void;
}

export async function registerServiceWorker(events: PwaEvents): Promise<void> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    const update = registerSW({
      immediate: true,
      onNeedRefresh: () => events.onNeedRefresh(() => void update(true)),
      onOfflineReady: () => events.onOfflineReady(),
    });
  } catch (error) {
    // Offline use is a bonus: the app works without it.
    console.warn('PlainSpice: the service worker could not be registered', error);
  }
}
