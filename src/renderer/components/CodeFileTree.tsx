import { useEffect, useMemo, useState } from 'react';
import type { ProjectFile } from '../../shared/types';

const getMainAPI = () => (typeof window !== 'undefined' ? window.mainAPI : undefined);

interface DirNode {
  name: string;
  path: string; // relative path of this directory ('' for root)
  dirs: Map<string, DirNode>;
  files: { name: string; rel: string }[];
}

function newDir(name: string, path: string): DirNode {
  return { name, path, dirs: new Map(), files: [] };
}

// Build a nested tree from the flat { name, dir } list returned by the main process.
function buildTree(files: ProjectFile[]): DirNode {
  const root = newDir('', '');
  for (const f of files) {
    const segments = !f.dir || f.dir === '.' ? [] : f.dir.split(/[\\/]/);
    let node = root;
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      let child = node.dirs.get(seg);
      if (!child) {
        child = newDir(seg, acc);
        node.dirs.set(seg, child);
      }
      node = child;
    }
    const rel = node.path ? `${node.path}/${f.name}` : f.name;
    node.files.push({ name: f.name, rel });
  }
  return root;
}

const sortedDirs = (node: DirNode) =>
  Array.from(node.dirs.values()).sort((a, b) => a.name.localeCompare(b.name));
const sortedFiles = (node: DirNode) =>
  [...node.files].sort((a, b) => a.name.localeCompare(b.name));

interface CodeFileTreeProps {
  projectPath: string;
  activeRel?: string; // relative path of the currently open file
  onSelect: (rel: string) => void;
}

export default function CodeFileTree({ projectPath, activeRel, onSelect }: CodeFileTreeProps) {
  const [files, setFiles] = useState<ProjectFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const api = getMainAPI();
    if (!api) { setError('Unavailable'); return; }
    let cancelled = false;
    setFiles(null);
    setError(null);
    api.listProjectFiles(projectPath)
      .then((list) => { if (!cancelled) setFiles(list); })
      .catch(() => { if (!cancelled) setError('Could not list files'); });
    return () => { cancelled = true; };
  }, [projectPath]);

  const root = useMemo(() => (files ? buildTree(files) : null), [files]);

  // Auto-expand the directories leading to the active file, plus the top level.
  useEffect(() => {
    if (!root) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const d of root.dirs.values()) next.add(d.path); // top-level dirs
      if (activeRel) {
        const segs = activeRel.split('/');
        let acc = '';
        for (let i = 0; i < segs.length - 1; i++) {
          acc = acc ? `${acc}/${segs[i]}` : segs[i];
          next.add(acc);
        }
      }
      return next;
    });
  }, [root, activeRel]);

  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });

  const renderDir = (node: DirNode, depth: number): React.ReactNode => (
    <>
      {sortedDirs(node).map((d) => {
        const isOpen = expanded.has(d.path);
        return (
          <div key={`d:${d.path}`}>
            <button
              type="button"
              className="code-tree-row code-tree-dir"
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => toggle(d.path)}
            >
              <svg className={`code-tree-caret ${isOpen ? 'open' : ''}`} width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="code-tree-name">{d.name}</span>
            </button>
            {isOpen && renderDir(d, depth + 1)}
          </div>
        );
      })}
      {sortedFiles(node).map((f) => (
        <button
          type="button"
          key={`f:${f.rel}`}
          className={`code-tree-row code-tree-file ${f.rel === activeRel ? 'is-active' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 + 13 }}
          onClick={() => onSelect(f.rel)}
          title={f.rel}
        >
          <span className="code-tree-name">{f.name}</span>
        </button>
      ))}
    </>
  );

  return (
    <div className="code-tree">
      <div className="code-tree-header">Files</div>
      <div className="code-tree-body">
        {error && <div className="code-tree-status">{error}</div>}
        {!error && !root && <div className="code-tree-status">Loading…</div>}
        {root && root.dirs.size === 0 && root.files.length === 0 && (
          <div className="code-tree-status">No files</div>
        )}
        {root && renderDir(root, 0)}
      </div>
    </div>
  );
}
