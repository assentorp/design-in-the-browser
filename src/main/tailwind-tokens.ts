import * as fs from 'fs';
import * as path from 'path';

export interface DesignToken {
  name: string;       // e.g. "text-blue-500", "p-4", "--color-primary"
  value: string;      // e.g. "#3b82f6", "1rem", "#1a1a1a"
  category: string;   // e.g. "color", "spacing", "typography", "border", "effect"
  source: 'tailwind' | 'css-var';
}

// Default Tailwind v3 color palette
const TAILWIND_COLORS: Record<string, Record<string, string>> = {
  slate: { '50': '#f8fafc', '100': '#f1f5f9', '200': '#e2e8f0', '300': '#cbd5e1', '400': '#94a3b8', '500': '#64748b', '600': '#475569', '700': '#334155', '800': '#1e293b', '900': '#0f172a', '950': '#020617' },
  gray: { '50': '#f9fafb', '100': '#f3f4f6', '200': '#e5e7eb', '300': '#d1d5db', '400': '#9ca3af', '500': '#6b7280', '600': '#4b5563', '700': '#374151', '800': '#1f2937', '900': '#111827', '950': '#030712' },
  zinc: { '50': '#fafafa', '100': '#f4f4f5', '200': '#e4e4e7', '300': '#d4d4d8', '400': '#a1a1aa', '500': '#71717a', '600': '#52525b', '700': '#3f3f46', '800': '#27272a', '900': '#18181b', '950': '#09090b' },
  neutral: { '50': '#fafafa', '100': '#f5f5f5', '200': '#e5e5e5', '300': '#d4d4d4', '400': '#a3a3a3', '500': '#737373', '600': '#525252', '700': '#404040', '800': '#262626', '900': '#171717', '950': '#0a0a0a' },
  stone: { '50': '#fafaf9', '100': '#f5f5f4', '200': '#e7e5e3', '300': '#d6d3d1', '400': '#a8a29e', '500': '#78716c', '600': '#57534e', '700': '#44403c', '800': '#292524', '900': '#1c1917', '950': '#0c0a09' },
  red: { '50': '#fef2f2', '100': '#fee2e2', '200': '#fecaca', '300': '#fca5a5', '400': '#f87171', '500': '#ef4444', '600': '#dc2626', '700': '#b91c1c', '800': '#991b1b', '900': '#7f1d1d', '950': '#450a0a' },
  orange: { '50': '#fff7ed', '100': '#ffedd5', '200': '#fed7aa', '300': '#fdba74', '400': '#fb923c', '500': '#f97316', '600': '#ea580c', '700': '#c2410c', '800': '#9a3412', '900': '#7c2d12', '950': '#431407' },
  amber: { '50': '#fffbeb', '100': '#fef3c7', '200': '#fde68a', '300': '#fcd34d', '400': '#fbbf24', '500': '#f59e0b', '600': '#d97706', '700': '#b45309', '800': '#92400e', '900': '#78350f', '950': '#451a03' },
  yellow: { '50': '#fefce8', '100': '#fef9c3', '200': '#fef08a', '300': '#fde047', '400': '#facc15', '500': '#eab308', '600': '#ca8a04', '700': '#a16207', '800': '#854d0e', '900': '#713f12', '950': '#422006' },
  lime: { '50': '#f7fee7', '100': '#ecfccb', '200': '#d9f99d', '300': '#bef264', '400': '#a3e635', '500': '#84cc16', '600': '#65a30d', '700': '#4d7c0f', '800': '#3f6212', '900': '#365314', '950': '#1a2e05' },
  green: { '50': '#f0fdf4', '100': '#dcfce7', '200': '#bbf7d0', '300': '#86efac', '400': '#4ade80', '500': '#22c55e', '600': '#16a34a', '700': '#15803d', '800': '#166534', '900': '#14532d', '950': '#052e16' },
  emerald: { '50': '#ecfdf5', '100': '#d1fae5', '200': '#a7f3d0', '300': '#6ee7b7', '400': '#34d399', '500': '#10b981', '600': '#059669', '700': '#047857', '800': '#065f46', '900': '#064e3b', '950': '#022c22' },
  teal: { '50': '#f0fdfa', '100': '#ccfbf1', '200': '#99f6e4', '300': '#5eead4', '400': '#2dd4bf', '500': '#14b8a6', '600': '#0d9488', '700': '#0f766e', '800': '#115e59', '900': '#134e4a', '950': '#042f2e' },
  cyan: { '50': '#ecfeff', '100': '#cffafe', '200': '#a5f3fc', '300': '#67e8f9', '400': '#22d3ee', '500': '#06b6d4', '600': '#0891b2', '700': '#0e7490', '800': '#155e75', '900': '#164e63', '950': '#083344' },
  sky: { '50': '#f0f9ff', '100': '#e0f2fe', '200': '#bae6fd', '300': '#7dd3fc', '400': '#38bdf8', '500': '#0ea5e9', '600': '#0284c7', '700': '#0369a1', '800': '#075985', '900': '#0c4a6e', '950': '#082f49' },
  blue: { '50': '#eff6ff', '100': '#dbeafe', '200': '#bfdbfe', '300': '#93c5fd', '400': '#60a5fa', '500': '#3b82f6', '600': '#2563eb', '700': '#1d4ed8', '800': '#1e40af', '900': '#1e3a8a', '950': '#172554' },
  indigo: { '50': '#eef2ff', '100': '#e0e7ff', '200': '#c7d2fe', '300': '#a5b4fc', '400': '#818cf8', '500': '#6366f1', '600': '#4f46e5', '700': '#4338ca', '800': '#3730a3', '900': '#312e81', '950': '#1e1b4e' },
  violet: { '50': '#f5f3ff', '100': '#ede9fe', '200': '#ddd6fe', '300': '#c4b5fd', '400': '#a78bfa', '500': '#8b5cf6', '600': '#7c3aed', '700': '#6d28d9', '800': '#5b21b6', '900': '#4c1d95', '950': '#2e1065' },
  purple: { '50': '#faf5ff', '100': '#f3e8ff', '200': '#e9d5ff', '300': '#d8b4fe', '400': '#c084fc', '500': '#a855f7', '600': '#9333ea', '700': '#7e22ce', '800': '#6b21a8', '900': '#581c87', '950': '#3b0764' },
  fuchsia: { '50': '#fdf4ff', '100': '#fae8ff', '200': '#f5d0fe', '300': '#f0abfc', '400': '#e879f9', '500': '#d946ef', '600': '#c026d3', '700': '#a21caf', '800': '#86198f', '900': '#701a75', '950': '#4a044e' },
  pink: { '50': '#fdf2f8', '100': '#fce7f3', '200': '#fbcfe8', '300': '#f9a8d4', '400': '#f472b6', '500': '#ec4899', '600': '#db2777', '700': '#be185d', '800': '#9d174d', '900': '#831843', '950': '#500724' },
  rose: { '50': '#fff1f2', '100': '#ffe4e6', '200': '#fecdd3', '300': '#fda4af', '400': '#fb7185', '500': '#f43f5e', '600': '#e11d48', '700': '#be123c', '800': '#9f1239', '900': '#881337', '950': '#4c0519' },
};

const TAILWIND_STANDALONE_COLORS: Record<string, string> = {
  'black': '#000000',
  'white': '#ffffff',
  'transparent': 'transparent',
};

const TAILWIND_SPACING: Record<string, string> = {
  '0': '0px', '0.5': '0.125rem', '1': '0.25rem', '1.5': '0.375rem',
  '2': '0.5rem', '2.5': '0.625rem', '3': '0.75rem', '3.5': '0.875rem',
  '4': '1rem', '5': '1.25rem', '6': '1.5rem', '7': '1.75rem',
  '8': '2rem', '9': '2.25rem', '10': '2.5rem', '11': '2.75rem',
  '12': '3rem', '14': '3.5rem', '16': '4rem', '20': '5rem',
  '24': '6rem', '28': '7rem', '32': '8rem', '36': '9rem',
  '40': '10rem', '44': '11rem', '48': '12rem', '52': '13rem',
  '56': '14rem', '60': '15rem', '64': '16rem', '72': '18rem',
  '80': '20rem', '96': '24rem', 'px': '1px',
};

const TAILWIND_FONT_SIZES: Record<string, string> = {
  'xs': '0.75rem', 'sm': '0.875rem', 'base': '1rem', 'lg': '1.125rem',
  'xl': '1.25rem', '2xl': '1.5rem', '3xl': '1.875rem', '4xl': '2.25rem',
  '5xl': '3rem', '6xl': '3.75rem', '7xl': '4.5rem', '8xl': '6rem', '9xl': '8rem',
};

const TAILWIND_FONT_WEIGHTS: Record<string, string> = {
  'thin': '100', 'extralight': '200', 'light': '300', 'normal': '400',
  'medium': '500', 'semibold': '600', 'bold': '700', 'extrabold': '800', 'black': '900',
};

const TAILWIND_BORDER_RADIUS: Record<string, string> = {
  'none': '0px', 'sm': '0.125rem', '': '0.25rem', 'md': '0.375rem',
  'lg': '0.5rem', 'xl': '0.75rem', '2xl': '1rem', '3xl': '1.5rem', 'full': '9999px',
};

const TAILWIND_SHADOWS: Record<string, string> = {
  'sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  '': '0 1px 3px 0 rgb(0 0 0 / 0.1)',
  'md': '0 4px 6px -1px rgb(0 0 0 / 0.1)',
  'lg': '0 10px 15px -3px rgb(0 0 0 / 0.1)',
  'xl': '0 20px 25px -5px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  'none': 'none',
};

const TAILWIND_OPACITY: Record<string, string> = {
  '0': '0', '5': '0.05', '10': '0.1', '15': '0.15', '20': '0.2', '25': '0.25',
  '30': '0.3', '35': '0.35', '40': '0.4', '45': '0.45', '50': '0.5',
  '55': '0.55', '60': '0.6', '65': '0.65', '70': '0.7', '75': '0.75',
  '80': '0.8', '85': '0.85', '90': '0.9', '95': '0.95', '100': '1',
};

function generateColorTokens(colors: Record<string, Record<string, string>>): DesignToken[] {
  const tokens: DesignToken[] = [];
  const colorPrefixes = ['text', 'bg', 'border'];

  for (const [colorName, shades] of Object.entries(colors)) {
    for (const [shade, value] of Object.entries(shades)) {
      const suffix = shade === 'DEFAULT' ? '' : `-${shade}`;
      for (const prefix of colorPrefixes) {
        tokens.push({
          name: `${prefix}-${colorName}${suffix}`,
          value,
          category: 'color',
          source: 'tailwind',
        });
      }
    }
  }

  for (const [colorName, value] of Object.entries(TAILWIND_STANDALONE_COLORS)) {
    for (const prefix of ['text', 'bg', 'border']) {
      tokens.push({ name: `${prefix}-${colorName}`, value, category: 'color', source: 'tailwind' });
    }
  }

  return tokens;
}

function generateSpacingTokens(): DesignToken[] {
  const tokens: DesignToken[] = [];
  const prefixes = ['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'gap', 'gap-x', 'gap-y', 'w', 'h', 'space-x', 'space-y'];

  for (const [size, value] of Object.entries(TAILWIND_SPACING)) {
    for (const prefix of prefixes) {
      tokens.push({ name: `${prefix}-${size}`, value, category: 'spacing', source: 'tailwind' });
    }
  }
  return tokens;
}

function generateTypographyTokens(): DesignToken[] {
  const tokens: DesignToken[] = [];

  for (const [size, value] of Object.entries(TAILWIND_FONT_SIZES)) {
    tokens.push({ name: `text-${size}`, value, category: 'typography', source: 'tailwind' });
  }
  for (const [weight, value] of Object.entries(TAILWIND_FONT_WEIGHTS)) {
    tokens.push({ name: `font-${weight}`, value, category: 'typography', source: 'tailwind' });
  }

  const leadingValues: Record<string, string> = {
    'none': '1', 'tight': '1.25', 'snug': '1.375', 'normal': '1.5', 'relaxed': '1.625', 'loose': '2',
  };
  for (const [name, value] of Object.entries(leadingValues)) {
    tokens.push({ name: `leading-${name}`, value, category: 'typography', source: 'tailwind' });
  }

  const trackingValues: Record<string, string> = {
    'tighter': '-0.05em', 'tight': '-0.025em', 'normal': '0em', 'wide': '0.025em', 'wider': '0.05em', 'widest': '0.1em',
  };
  for (const [name, value] of Object.entries(trackingValues)) {
    tokens.push({ name: `tracking-${name}`, value, category: 'typography', source: 'tailwind' });
  }

  return tokens;
}

function generateBorderTokens(): DesignToken[] {
  const tokens: DesignToken[] = [];
  for (const [size, value] of Object.entries(TAILWIND_BORDER_RADIUS)) {
    tokens.push({ name: size ? `rounded-${size}` : 'rounded', value, category: 'border', source: 'tailwind' });
  }
  return tokens;
}

function generateEffectTokens(): DesignToken[] {
  const tokens: DesignToken[] = [];
  for (const [size, value] of Object.entries(TAILWIND_SHADOWS)) {
    tokens.push({ name: size ? `shadow-${size}` : 'shadow', value, category: 'effect', source: 'tailwind' });
  }
  for (const [pct, value] of Object.entries(TAILWIND_OPACITY)) {
    tokens.push({ name: `opacity-${pct}`, value, category: 'effect', source: 'tailwind' });
  }
  return tokens;
}

function getDefaultTailwindTokens(): DesignToken[] {
  return [
    ...generateColorTokens(TAILWIND_COLORS),
    ...generateSpacingTokens(),
    ...generateTypographyTokens(),
    ...generateBorderTokens(),
    ...generateEffectTokens(),
  ];
}

// Extract the content of a braced block starting at the `{` at position `start`
function extractBracedBlock(content: string, start: number): string | null {
  if (content[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') { depth--; if (depth === 0) return content.slice(start + 1, i); }
  }
  return null;
}

// Find the braced block for a given key (e.g. "colors", "spacing") in config text
function findKeyBlock(content: string, key: string): string | null {
  const regex = new RegExp(`['"]?${key}['"]?\\s*:\\s*\\{`, 'g');
  let match;
  while ((match = regex.exec(content)) !== null) {
    const braceStart = content.indexOf('{', match.index + key.length);
    if (braceStart !== -1) {
      const block = extractBracedBlock(content, braceStart);
      if (block) return block;
    }
  }
  return null;
}

// Build a lookup table for resolving JS variable references in tailwind configs.
// Handles: defaultColors.slate[900], transloaditColors.grayDarkest, 'literal', etc.
function buildResolutionContext(configContent: string): Record<string, string> {
  const ctx: Record<string, string> = {};

  // Find what name(s) tailwindcss/colors was imported as
  const colorImportNames = new Set<string>();
  const esmImport = configContent.match(/import\s+(\w+)\s+from\s+['"]tailwindcss\/colors['"]/);
  if (esmImport) colorImportNames.add(esmImport[1]);
  const cjsRequire = configContent.match(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]tailwindcss\/colors['"]\s*\)/);
  if (cjsRequire) colorImportNames.add(cjsRequire[1]);

  // Map varName.colorFamily[shade] and varName.colorFamily.shade to hex values
  for (const importName of Array.from(colorImportNames)) {
    for (const [colorName, shades] of Object.entries(TAILWIND_COLORS)) {
      for (const [shade, value] of Object.entries(shades)) {
        ctx[`${importName}.${colorName}[${shade}]`] = value;
        ctx[`${importName}.${colorName}['${shade}']`] = value;
        ctx[`${importName}.${colorName}["${shade}"]`] = value;
      }
    }
    for (const [name, value] of Object.entries(TAILWIND_STANDALONE_COLORS)) {
      ctx[`${importName}.${name}`] = value;
    }
  }

  // Parse const/let/var object declarations (e.g. const myColors = { ... })
  const constRegex = /(?:const|let|var)\s+(\w+)\s*=\s*\{/g;
  let constMatch;
  while ((constMatch = constRegex.exec(configContent)) !== null) {
    const varName = constMatch[1];
    const braceStart = configContent.indexOf('{', constMatch.index);
    const block = extractBracedBlock(configContent, braceStart);
    if (!block) continue;

    // Parse entries: key: 'value' or key: expr
    const entryRegex = /(\w[\w]*)\s*:\s*(?:['"]([^'"]+)['"]|([^,\n}]+))/g;
    let entryMatch;
    while ((entryMatch = entryRegex.exec(block)) !== null) {
      const key = entryMatch[1];
      const quotedVal = entryMatch[2];
      const exprVal = entryMatch[3]?.trim().replace(/\/\/.*$/, '').trim();

      if (quotedVal) {
        ctx[`${varName}.${key}`] = quotedVal;
      } else if (exprVal && ctx[exprVal]) {
        ctx[`${varName}.${key}`] = ctx[exprVal];
      }
    }
  }

  return ctx;
}

// Resolve a raw value expression to an actual string value
function resolveValue(raw: string, ctx: Record<string, string>): string {
  raw = raw.trim().replace(/\/\/.*$/, '').replace(/,\s*$/, '').trim();
  // Quoted string literal
  const strMatch = raw.match(/^['"`](.+?)['"`]$/);
  if (strMatch) return strMatch[1];
  // Context lookup (variable references like transloaditColors.grayDarkest)
  if (ctx[raw]) return ctx[raw];
  // Unresolvable — return the expression itself as a hint
  return raw;
}

// Parse key-value pairs from a config block, resolving JS expressions via context.
// Returns { colorName: { shade: value } } for nested objects and { colorName: { DEFAULT: value } } for flat entries.
function parseConfigBlock(block: string, ctx: Record<string, string>): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};

  // First pass: find nested objects (key: { ... })
  const nestedRegex = /['"]?([\w][\w-]*)['"]?\s*:\s*\{/g;
  let match;
  while ((match = nestedRegex.exec(block)) !== null) {
    const name = match[1];
    const braceStart = block.indexOf('{', match.index + name.length);
    const inner = extractBracedBlock(block, braceStart);
    if (!inner) continue;
    result[name] = {};
    // Parse entries inside the nested object
    const pairRegex = /['"]?([\w][\w-]*)['"]?\s*:\s*([^,}\n]+)/g;
    let pairMatch;
    while ((pairMatch = pairRegex.exec(inner)) !== null) {
      const val = resolveValue(pairMatch[2], ctx);
      if (val) result[name][pairMatch[1]] = val;
    }
  }

  // Second pass: find flat entries (key: value) — skip keys already parsed as nested
  const flatRegex = /['"]?([\w][\w-]*)['"]?\s*:\s*([^,{}\n]+)/gm;
  while ((match = flatRegex.exec(block)) !== null) {
    const key = match[1];
    if (result[key]) continue; // already parsed as nested
    const val = resolveValue(match[2], ctx);
    if (val) result[key] = { DEFAULT: val };
  }

  return result;
}

function parseCustomColors(configContent: string, ctx: Record<string, string>): Record<string, Record<string, string>> {
  const extendBlock = findKeyBlock(configContent, 'extend');
  const colorsBlock = extendBlock
    ? findKeyBlock(extendBlock, 'colors')
    : findKeyBlock(configContent, 'colors');
  if (!colorsBlock) return {};
  return parseConfigBlock(colorsBlock, ctx);
}

function parseCustomValues(configContent: string, key: string, ctx: Record<string, string>): Record<string, string> {
  const extendBlock = findKeyBlock(configContent, 'extend');
  const block = extendBlock
    ? findKeyBlock(extendBlock, key)
    : findKeyBlock(configContent, key);
  if (!block) return {};
  const result: Record<string, string> = {};
  const pairRegex = /['"]?([\w][\w.-]*)['"]?\s*:\s*([^,{}\n]+)/gm;
  let match;
  while ((match = pairRegex.exec(block)) !== null) {
    const val = resolveValue(match[2], ctx);
    if (val) result[match[1]] = val;
  }
  return result;
}

function parseCssCustomProperties(projectPath: string): DesignToken[] {
  const tokens: DesignToken[] = [];
  const cssFiles: string[] = [];
  const searchDirs = ['src', 'styles', 'css', 'app', '.'];
  const cssExts = ['.css', '.scss'];

  for (const dir of searchDirs) {
    const fullDir = path.join(projectPath, dir);
    try {
      const entries = fs.readdirSync(fullDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && cssExts.some(ext => entry.name.endsWith(ext))) {
          cssFiles.push(path.join(fullDir, entry.name));
        }
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          try {
            const subEntries = fs.readdirSync(path.join(fullDir, entry.name), { withFileTypes: true });
            for (const subEntry of subEntries) {
              if (subEntry.isFile() && cssExts.some(ext => subEntry.name.endsWith(ext))) {
                cssFiles.push(path.join(fullDir, entry.name, subEntry.name));
              }
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  const seen = new Set<string>();
  for (const cssFile of cssFiles) {
    try {
      const content = fs.readFileSync(cssFile, 'utf-8');

      // CSS custom properties (--var: value;)
      const varRegex = /(--[\w-]+)\s*:\s*([^;]+);/g;
      let match;
      while ((match = varRegex.exec(content)) !== null) {
        const name = match[1].trim();
        const value = match[2].trim();
        if (seen.has(name)) continue;
        seen.add(name);
        let category = 'other';
        if (value.match(/^#|^rgb|^hsl|^oklch|transparent/)) category = 'color';
        else if (value.match(/^[\d.]+(rem|em|px|%)/)) category = 'spacing';
        tokens.push({ name, value, category, source: 'css-var' });

        // Tailwind v4 CSS theme variables → generate utility class tokens
        const colorMatch = name.match(/^--color-(.+)$/);
        if (colorMatch) {
          const cls = colorMatch[1];
          for (const prefix of ['text', 'bg', 'border']) {
            tokens.push({ name: `${prefix}-${cls}`, value, category: 'color', source: 'tailwind' });
          }
        }
        const spacingMatch = name.match(/^--spacing-(.+)$/);
        if (spacingMatch) {
          const cls = spacingMatch[1];
          for (const prefix of ['p', 'px', 'py', 'm', 'mx', 'my', 'gap', 'w', 'h']) {
            tokens.push({ name: `${prefix}-${cls}`, value, category: 'spacing', source: 'tailwind' });
          }
        }
        const fontSizeMatch = name.match(/^--font-size-(.+)$/);
        if (fontSizeMatch) {
          tokens.push({ name: `text-${fontSizeMatch[1]}`, value, category: 'typography', source: 'tailwind' });
        }
        const radiusMatch = name.match(/^--radius-(.+)$/);
        if (radiusMatch) {
          tokens.push({ name: `rounded-${radiusMatch[1]}`, value, category: 'border', source: 'tailwind' });
        }
        const shadowMatch = name.match(/^--shadow-(.+)$/);
        if (shadowMatch) {
          tokens.push({ name: `shadow-${shadowMatch[1]}`, value, category: 'effect', source: 'tailwind' });
        }
      }

      // SCSS variables ($var: value;)
      if (cssFile.endsWith('.scss')) {
        // First pass: build resolution context for $var references
        const scssCtx: Record<string, string> = {};
        const scssVarRegex = /\$([\w-]+)\s*:\s*([^;]+);/g;
        let scssMatch;
        while ((scssMatch = scssVarRegex.exec(content)) !== null) {
          const raw = scssMatch[2].replace(/\s*!default\s*$/, '').trim();
          const strVal = raw.match(/^['"](.+)['"]$/);
          scssCtx[`$${scssMatch[1]}`] = strVal ? strVal[1] : raw;
        }

        // Second pass: resolve references and emit tokens
        scssVarRegex.lastIndex = 0;
        while ((scssMatch = scssVarRegex.exec(content)) !== null) {
          const name = `$${scssMatch[1]}`;
          if (seen.has(name)) continue;
          seen.add(name);
          let raw = scssMatch[2].replace(/\s*!default\s*$/, '').trim();
          const strVal = raw.match(/^['"](.+)['"]$/);
          if (strVal) raw = strVal[1];
          // Resolve $var references (one level deep)
          if (raw.startsWith('$') && scssCtx[raw]) raw = scssCtx[raw];
          let category = 'other';
          if (raw.match(/^#|^rgb|^hsl|^oklch|transparent/)) category = 'color';
          else if (raw.match(/^[\d.]+(rem|em|px|%)/)) category = 'spacing';
          tokens.push({ name, value: raw, category, source: 'css-var' });
        }

        // SCSS maps: $map: (key: value, ...);
        const mapRegex = /\$([\w-]+)\s*:\s*\(([^)]+)\)\s*(?:!default\s*)?;/g;
        let mapMatch;
        while ((mapMatch = mapRegex.exec(content)) !== null) {
          const mapName = mapMatch[1];
          const entries = mapMatch[2];
          const entryRegex = /([\w-]+)\s*:\s*([^,)]+)/g;
          let entryMatch;
          while ((entryMatch = entryRegex.exec(entries)) !== null) {
            const entryName = `$${mapName}.${entryMatch[1]}`;
            if (seen.has(entryName)) continue;
            seen.add(entryName);
            let val = entryMatch[2].trim().replace(/\s*!default\s*$/, '');
            const entryStr = val.match(/^['"](.+)['"]$/);
            if (entryStr) val = entryStr[1];
            if (val.startsWith('$') && scssCtx[val]) val = scssCtx[val];
            let category = 'other';
            if (val.match(/^#|^rgb|^hsl|^oklch|transparent/)) category = 'color';
            else if (val.match(/^[\d.]+(rem|em|px|%)/)) category = 'spacing';
            tokens.push({ name: entryName, value: val, category, source: 'css-var' });
          }
        }
      }
    } catch { /* ignore */ }
  }

  return tokens;
}

function findTailwindConfig(projectPath: string): string | null {
  const configNames = ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs', 'tailwind.config.cjs'];
  for (const name of configNames) {
    const configPath = path.join(projectPath, name);
    if (fs.existsSync(configPath)) return configPath;
  }
  return null;
}

function hasTailwindInProject(projectPath: string): boolean {
  try {
    const pkgPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      return 'tailwindcss' in deps;
    }
  } catch { /* ignore */ }
  return false;
}

export function getDesignTokens(projectPath: string): DesignToken[] {
  const tokens: DesignToken[] = [];
  const configPath = findTailwindConfig(projectPath);
  const hasTailwind = configPath || hasTailwindInProject(projectPath);

  if (hasTailwind) {
    tokens.push(...getDefaultTailwindTokens());
  }

  if (configPath) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const ctx = buildResolutionContext(configContent);

      // Custom colors
      const customColors = parseCustomColors(configContent, ctx);
      if (Object.keys(customColors).length > 0) {
        tokens.push(...generateColorTokens(customColors));
      }

      // Custom spacing
      const customSpacing = parseCustomValues(configContent, 'spacing', ctx);
      const spacingPrefixes = ['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'gap', 'w', 'h'];
      for (const [size, value] of Object.entries(customSpacing)) {
        for (const prefix of spacingPrefixes) {
          tokens.push({ name: `${prefix}-${size}`, value, category: 'spacing', source: 'tailwind' });
        }
      }

      // Custom font sizes
      const customFontSize = parseCustomValues(configContent, 'fontSize', ctx);
      for (const [size, value] of Object.entries(customFontSize)) {
        tokens.push({ name: `text-${size}`, value, category: 'typography', source: 'tailwind' });
      }

      // Custom border radius
      const customBorderRadius = parseCustomValues(configContent, 'borderRadius', ctx);
      for (const [size, value] of Object.entries(customBorderRadius)) {
        tokens.push({ name: size ? `rounded-${size}` : 'rounded', value, category: 'border', source: 'tailwind' });
      }
    } catch { /* ignore parse errors */ }
  }

  tokens.push(...parseCssCustomProperties(projectPath));
  return tokens;
}
