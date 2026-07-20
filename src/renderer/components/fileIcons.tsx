import type { ReactNode } from 'react';

// Small file-type markers for the file tree and quick-open palette.
// Two shapes: a short colored text badge (TS, JS, …) for code, and a 12px
// stroke glyph for binary-ish types. Colors are desaturated for the dark UI.

const badge = (label: string, color: string): ReactNode => (
  <span className="file-icon file-icon-badge" style={{ color }}>{label}</span>
);

const glyph = (paths: ReactNode, color?: string): ReactNode => (
  <span className={`file-icon${color ? '' : ' file-icon-default'}`} style={color ? { color } : undefined}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths}
    </svg>
  </span>
);

const imageGlyph = (
  <>
    <rect x="3" y="3" width="18" height="18" rx="2"></rect>
    <circle cx="9" cy="9" r="2"></circle>
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"></path>
  </>
);

const lockGlyph = (
  <>
    <rect x="5" y="11" width="14" height="10" rx="2"></rect>
    <path d="M8 11V7a4 4 0 0 1 8 0v4"></path>
  </>
);

const gitGlyph = (
  <>
    <circle cx="6" cy="6" r="2.5"></circle>
    <circle cx="6" cy="18" r="2.5"></circle>
    <circle cx="18" cy="8" r="2.5"></circle>
    <path d="M6 8.5v7"></path>
    <path d="M15.5 8.5A6.5 6.5 0 0 1 8.5 15"></path>
  </>
);

const fileGlyph = (
  <>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"></path>
    <path d="M14 2v6h6"></path>
  </>
);

export function fileIcon(name: string): ReactNode {
  const lower = name.toLowerCase();
  if (lower === '.gitignore' || lower === '.gitattributes' || lower === '.gitmodules') {
    return glyph(gitGlyph, '#d98a68');
  }
  if (lower === 'dockerfile') return badge('D', '#6cb2dd');
  const ext = lower.includes('.') ? lower.split('.').pop()! : '';
  switch (ext) {
    case 'ts':
    case 'mts':
    case 'cts':
    case 'tsx':
      return badge('TS', '#69a8d8');
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return badge('JS', '#dcc26a');
    case 'json':
      return badge('{}', '#c9c97a');
    case 'html':
    case 'htm':
      return badge('<>', '#dd8a5f');
    case 'css':
      return badge('#', '#7ea6e0');
    case 'scss':
    case 'sass':
      return badge('#', '#cd7fa5');
    case 'less':
      return badge('#', '#8598c9');
    case 'vue':
      return badge('V', '#6ebd94');
    case 'svelte':
      return badge('S', '#dd7a5f');
    case 'md':
    case 'mdx':
      return badge('M', '#8fb0c9');
    case 'yml':
    case 'yaml':
    case 'toml':
      return badge('Y', '#b3a583');
    case 'sh':
    case 'zsh':
    case 'bash':
      return badge('$', '#93b587');
    case 'py':
      return badge('PY', '#7ea6d8');
    case 'svg':
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'ico':
    case 'avif':
      return glyph(imageGlyph, '#8faf7f');
    case 'lock':
      return glyph(lockGlyph, '#a89d8a');
    default:
      return glyph(fileGlyph);
  }
}
