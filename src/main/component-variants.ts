import * as fs from 'fs';
import * as path from 'path';

// Tailwind component kits (shadcn/ui, and anything else built on
// class-variance-authority or tailwind-variants) declare their sizes and
// variants in the source rather than in the markup — the browser only ever sees
// the merged utility classes. Parsing those declarations is what lets the design
// panel offer "Button: size sm/lg, variant default/ghost/…" for Tailwind
// projects, the way class families do for DaisyUI/Bootstrap.

export interface VariantOption {
  name: string;      // e.g. "lg"
  classes: string[]; // utilities this option applies
}

export interface VariantGroup {
  name: string;              // e.g. "size"
  options: VariantOption[];
  defaultOption?: string;
}

export interface ComponentVariantSet {
  name: string;      // e.g. "Button"
  file: string;      // project-relative path of the declaration
  base: string[];    // classes every instance carries
  slot?: string;     // data-slot value, when the component sets one
  groups: VariantGroup[];
}

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  'coverage', '.cache', '.turbo', '.vercel', '.svelte-kit', 'storybook-static',
]);
const INCLUDE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte']);
const MAX_FILES = 4000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_SETS = 200;

// Walk to the closing bracket that matches the opening one at `start`,
// skipping over strings, template literals and comments.
function matchBracket(src: string, start: number): number {
  const open = src[start];
  const close = open === '(' ? ')' : open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2);
      if (i === -1) return -1;
      i++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Split an object body into its top-level `key: value` pairs
function objectEntries(body: string): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length) break;
    if (body[i] === '/' && (body[i + 1] === '/' || body[i + 1] === '*')) {
      if (body[i + 1] === '/') { while (i < body.length && body[i] !== '\n') i++; }
      else { const end = body.indexOf('*/', i + 2); i = end === -1 ? body.length : end + 2; }
      continue;
    }
    // key: bare identifier, quoted string, or a numeric/boolean literal
    let key = '';
    if (body[i] === '"' || body[i] === "'") {
      const quote = body[i];
      const end = body.indexOf(quote, i + 1);
      if (end === -1) break;
      key = body.slice(i + 1, end);
      i = end + 1;
    } else {
      const start = i;
      while (i < body.length && /[\w$-]/.test(body[i])) i++;
      key = body.slice(start, i);
    }
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] !== ':' || !key) { // not a plain key/value pair — skip ahead
      while (i < body.length && body[i] !== ',') i++;
      continue;
    }
    i++;
    while (i < body.length && /\s/.test(body[i])) i++;
    const valueStart = i;
    if (body[i] === '{' || body[i] === '[' || body[i] === '(') {
      const end = matchBracket(body, i);
      if (end === -1) break;
      i = end + 1;
    } else {
      // scalar value: read to the next top-level comma
      while (i < body.length) {
        const ch = body[i];
        if (ch === '"' || ch === "'" || ch === '`') {
          const quote = ch;
          i++;
          while (i < body.length && body[i] !== quote) {
            if (body[i] === '\\') i++;
            i++;
          }
          i++;
          continue;
        }
        if (ch === ',') break;
        i++;
      }
    }
    entries.push({ key, value: body.slice(valueStart, i).trim() });
  }
  return entries;
}

// Pull the class names out of a value that may be a string, a template
// literal, an array of either, or a cn()/clsx() call wrapping those.
function classesFrom(value: string): string[] {
  const out: string[] = [];
  const stringRe = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = stringRe.exec(value)) !== null) {
    // Drop ${...} interpolations; whatever they resolve to isn't statically known
    const literal = match[2].replace(/\$\{[^}]*\}/g, ' ');
    for (const cls of literal.split(/\s+/)) {
      if (cls) out.push(cls);
    }
  }
  return out;
}

function findValue(entries: Array<{ key: string; value: string }>, key: string): string | null {
  for (const entry of entries) {
    if (entry.key === key) return entry.value;
  }
  return null;
}

function stripOuter(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed.slice(1, -1);
  return trimmed;
}

function componentNameFor(src: string, callStart: number, file: string): string {
  // `const buttonVariants = cva(...)` / `export const badge = tv(...)`
  const before = src.slice(Math.max(0, callStart - 200), callStart);
  const decl = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*$/);
  let name = decl ? decl[1] : path.basename(file).replace(/\.[^.]+$/, '');
  name = name.replace(/(Variants|Variant|Styles|Style|Classes|Class|Css)$/i, '');
  name = name.replace(/[-_]+([a-zA-Z])/g, (_m, c: string) => c.toUpperCase());
  if (!name) name = 'Component';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Parse one cva()/tv() call into a variant set
function parseCall(src: string, callStart: number, openParen: number, file: string, slot?: string): ComponentVariantSet | null {
  const closeParen = matchBracket(src, openParen);
  if (closeParen === -1) return null;
  const args = src.slice(openParen + 1, closeParen);

  let base: string[] = [];
  let configBody: string | null = null;

  const firstNonSpace = args.search(/\S/);
  if (firstNonSpace !== -1 && args[firstNonSpace] === '{') {
    // tailwind-variants: tv({ base, variants, defaultVariants })
    const end = matchBracket(args, firstNonSpace);
    if (end === -1) return null;
    configBody = args.slice(firstNonSpace + 1, end);
    const baseValue = findValue(objectEntries(configBody), 'base');
    if (baseValue) base = classesFrom(baseValue);
  } else {
    // cva(base, { variants, defaultVariants })
    const configStart = args.indexOf('{');
    base = classesFrom(configStart === -1 ? args : args.slice(0, configStart));
    if (configStart !== -1) {
      const end = matchBracket(args, configStart);
      if (end !== -1) configBody = args.slice(configStart + 1, end);
    }
  }
  if (!configBody) return null;

  const config = objectEntries(configBody);
  const variantsValue = findValue(config, 'variants');
  if (!variantsValue) return null;

  const defaults: Record<string, string> = {};
  const defaultsValue = findValue(config, 'defaultVariants');
  if (defaultsValue) {
    for (const entry of objectEntries(stripOuter(defaultsValue))) {
      const literal = entry.value.match(/^['"`](.*)['"`]$/);
      defaults[entry.key] = literal ? literal[1] : entry.value.replace(/,$/, '').trim();
    }
  }

  const groups: VariantGroup[] = [];
  for (const groupEntry of objectEntries(stripOuter(variantsValue))) {
    if (!groupEntry.value.trim().startsWith('{')) continue;
    const options: VariantOption[] = [];
    for (const optionEntry of objectEntries(stripOuter(groupEntry.value))) {
      const classes = classesFrom(optionEntry.value);
      options.push({ name: optionEntry.key, classes });
    }
    // A group needs at least two choices to be worth offering
    if (options.length < 2) continue;
    groups.push({
      name: groupEntry.key,
      options,
      defaultOption: defaults[groupEntry.key],
    });
  }
  if (!groups.length) return null;

  return {
    name: componentNameFor(src, callStart, file),
    file,
    base,
    slot,
    groups,
  };
}

function parseFile(src: string, file: string): ComponentVariantSet[] {
  const sets: ComponentVariantSet[] = [];
  const slotMatch = src.match(/data-slot\s*=\s*["']([\w-]+)["']/);
  const slot = slotMatch ? slotMatch[1] : undefined;
  const callRe = /\b(cva|tv)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(src)) !== null) {
    const openParen = match.index + match[0].length - 1;
    const set = parseCall(src, match.index, openParen, file, slot);
    if (set) sets.push(set);
  }
  return sets;
}

export function getComponentVariants(projectPath: string): ComponentVariantSet[] {
  const sets: ComponentVariantSet[] = [];
  let filesSeen = 0;

  function walk(dir: string): void {
    if (filesSeen >= MAX_FILES || sets.length >= MAX_SETS) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (filesSeen >= MAX_FILES || sets.length >= MAX_SETS) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!INCLUDE_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
      filesSeen++;
      try {
        const stat = fs.statSync(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        const src = fs.readFileSync(full, 'utf-8');
        // Cheap reject before doing any real parsing
        if (!/\b(cva|tv)\s*\(/.test(src)) continue;
        const rel = path.relative(projectPath, full);
        for (const set of parseFile(src, rel)) {
          sets.push(set);
          if (sets.length >= MAX_SETS) return;
        }
      } catch {
        /* unreadable file — skip */
      }
    }
  }

  walk(projectPath);
  return sets;
}
