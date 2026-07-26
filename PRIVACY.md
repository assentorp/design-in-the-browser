# Privacy

Dosmos respects your privacy. Here's what you need to know.

## Analytics

Official release builds include opt-in analytics via [PostHog](https://posthog.com). Analytics are **off by default** and require explicit consent during onboarding.

When enabled, we collect:

- App usage events (feature interactions, not content)
- Error/crash reports

We **do not** collect:

- Page content or URLs you visit
- Annotation text or screenshots
- File contents or project paths
- IP addresses
- Session recordings
- DOM interactions (autocapture is disabled)

You can disable analytics at any time in Settings.

## Self-built Versions

If you build the app from source, analytics are not active. The PostHog key is only injected into official production builds.

## Data Storage

- Analytics data is sent to PostHog's EU servers (`eu.i.posthog.com`)
- App settings are stored locally on your machine
- Screenshots are stored in your OS temp folder and cleaned up automatically
- No data is sent to any server other than PostHog (when analytics are enabled)

## Third Parties

The app connects to the internet for:

- **Auto-updates** -- Checks GitHub Releases for new versions
- **Analytics** -- PostHog (only when opted in)
- **Webview browsing** -- Whatever sites you navigate to in the built-in browser

No other network requests are made by the app itself.
