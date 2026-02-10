import posthog from 'posthog-js';

const POSTHOG_KEY = 'phc_GvJ6Ja6MY05KTmtD3Wj7QF3rCbczJwUQhLN8jPU8qqe';
const POSTHOG_HOST = 'https://eu.i.posthog.com';

export function initAnalytics(): void {
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
