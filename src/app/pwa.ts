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

/**
 * Ask the service worker to look for a newer PlainSpice now (a link made by a newer version was
 * opened). If there is one, the usual "new version" banner appears, with its Reload button: a plain
 * reload would keep serving the version the service worker already has.
 */
export function checkForUpdate(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .getRegistration()
    .then((registration) => registration?.update())
    .catch(() => undefined); // offline, or no service worker yet: the message still says what to do
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
