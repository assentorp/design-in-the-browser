import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectFile } from '../../shared/types';
import { fileIcon } from './fileIcons';

const getMainAPI = () => (typeof window !== 'undefined' ? window.mainAPI : undefined);

interface QuickOpenProps {
  projectPath: string;
  onSelect: (rel: string) => void;
  onClose: () => void;
}

// Cmd+P palette: fuzzy-ish file jump over the project file list, VS Code style.
export default function QuickOpen({ projectPath, onSelect, onClose }: QuickOpenProps) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const api = getMainAPI();
    if (!api) return;
    let cancelled = false;
    api.listProjectFiles(projectPath)
      .then((list) => { if (!cancelled) setFiles(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectPath]);

  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    const rows = files.map((f) => {
      const dir = !f.dir || f.dir === '.' ? '' : f.dir.replace(/\\/g, '/');
      return { name: f.name, dir, rel: dir ? `${dir}/${f.name}` : f.name, nameHit: false };
    });
    if (!q) {
      return rows.sort((a, b) => a.rel.localeCompare(b.rel)).slice(0, 50);
    }
    // Filename matches rank above path-only matches
    const hits = rows
      .map((r) => ({ ...r, nameHit: r.name.toLowerCase().includes(q) }))
      .filter((r) => r.nameHit || r.rel.toLowerCase().includes(q));
    hits.sort((a, b) => Number(b.nameHit) - Number(a.nameHit) || a.name.localeCompare(b.name));
    return hits.slice(0, 50);
  }, [files, q]);

  // Wrap the matched substring so it reads bold/bright, VS Code style
  const highlight = (text: string, active: boolean) => {
    if (!q || !active) return text;
    const i = text.toLowerCase().indexOf(q);
    if (i === -1) return text;
    return (
      <>
        {text.slice(0, i)}
        <span className="quick-open-match">{text.slice(i, i + q.length)}</span>
        {text.slice(i + q.length)}
      </>
    );
  };

  useEffect(() => { setIndex(0); }, [query]);

  // Keep the selected row visible while arrowing through the list
  useEffect(() => {
    listRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }, [index, results]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[index];
      if (r) onSelect(r.rel);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="quick-open-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="quick-open">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={onClose}
          placeholder="Go to file…"
          spellCheck={false}
          autoFocus
        />
        <div className="quick-open-results" ref={listRef}>
          {results.length === 0 && <div className="quick-open-empty">No matches</div>}
          {results.map((r, i) => (
            <button
              type="button"
              key={r.rel}
              className={`quick-open-row ${i === index ? 'is-selected' : ''}`}
              // preventDefault so the input's blur doesn't close us before click
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(r.rel)}
              onMouseMove={() => setIndex(i)}
              title={r.rel}
            >
              {fileIcon(r.name)}
              <span className="quick-open-name">{highlight(r.name, r.nameHit || !q)}</span>
              {r.dir && <span className="quick-open-dir">{highlight(r.dir, !r.nameHit)}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
