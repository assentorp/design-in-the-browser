import { app, BrowserWindow, net } from 'electron';

// Replace with your GitHub owner/repo after pushing
const OWNER = 'assentorp';
const REPO = 'ditb';

interface GitHubRelease {
  tag_name: string;
  html_url: string;
}

function compareVersions(current: string, latest: string): number {
  const c = current.replace(/^v/, '').split('.').map(Number);
  const l = latest.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (l[i] || 0) - (c[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function checkForUpdates(mainWindow: BrowserWindow) {
  if (!OWNER || !REPO) {
    console.log('[Updater] Skipping update check — OWNER/REPO not configured');
    return;
  }

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

  const request = net.request(url);
  request.setHeader('Accept', 'application/vnd.github.v3+json');
  request.setHeader('User-Agent', `${app.getName()}/${app.getVersion()}`);

  let body = '';

  request.on('response', (response) => {
    if (response.statusCode !== 200) {
      console.log('[Updater] GitHub API returned', response.statusCode);
      return;
    }

    response.on('data', (chunk) => {
      body += chunk.toString();
    });

    response.on('end', () => {
      try {
        const release: GitHubRelease = JSON.parse(body);
        const currentVersion = app.getVersion();
        const latestVersion = release.tag_name;

        if (compareVersions(currentVersion, latestVersion) > 0) {
          console.log(`[Updater] New version available: ${latestVersion} (current: ${currentVersion})`);
          mainWindow.webContents.send('app:update-available', {
            version: latestVersion.replace(/^v/, ''),
            url: release.html_url,
          });
        } else {
          console.log(`[Updater] Up to date (${currentVersion})`);
        }
      } catch (err) {
        console.error('[Updater] Failed to parse response:', err);
      }
    });
  });

  request.on('error', (err) => {
    console.error('[Updater] Request failed:', err);
  });

  request.end();
}
