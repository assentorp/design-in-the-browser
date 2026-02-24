import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined;

export function initAnalytics(): void {
  if (!POSTHOG_KEY || !POSTHOG_HOST) return;

  if (posthog.__loaded) {
    posthog.opt_in_capturing();
    return;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_exceptions: true,
    autocapture: false,          // no DOM click/input tracking — prevents PII leakage
    disable_session_recording: true, // no screen recordings
    ip: false,                   // don't collect IP addresses
    persistence: 'localStorage', // track unique users across sessions
  });
}

export function disableAnalytics(): void {
  if (posthog.__loaded) {
    posthog.opt_out_capturing();
  }
}
