import type { Session, ShellType, AnnotationData, MultiEditData } from './types';

const generateId = () => Math.random().toString(36).substr(2, 9);

export function createSession(
  config: { name: string; path: string; startCommand: string; shell?: ShellType } | null,
  index: number
): Session {
  const id = generateId();
  const firstTabId = `${id}-1`;
  return {
    id,
    name: config?.name || `Project ${index}`,
    projectPath: config?.path || '',
    startCommand: config?.startCommand || '',
    browserWidth: 60,
    terminalCollapsed: false,
    url: 'http://localhost:3000',
    terminalTabs: [{ id: firstTabId, name: 'Terminal 1' }],
    activeTerminalTabId: firstTabId,
    terminalTabCounter: 1,
    devServerTabId: null,
    cliToolTabId: null,
    cliTool: null,
    cliToolRunning: false,
    shell: config?.shell || 'default',
  };
}

export function getAnnotationLabel(data: AnnotationData): string {
  // Multi-edit (has annotations array)
  const multi = data as unknown as MultiEditData;
  if ('annotations' in multi && Array.isArray(multi.annotations)) {
    return `${multi.annotations.length} edits`;
  }

  const request = data.request || '';
  const truncate = (s: string, max: number) => s.length > max ? s.substring(0, max) + '...' : s;

  // Text selection
  if (data.selectedText) {
    const text = truncate(data.selectedText, 20);
    return truncate(`"${text}": ${request}`, 50);
  }

  // Multi-select
  if (data.elements && data.elements.length > 1) {
    return truncate(`${data.elements.length} elements: ${request}`, 50);
  }

  // Single element
  if (data.element) {
    const tag = `<${data.element.tagName.toLowerCase()}>`;
    const text = data.element.text ? ` "${truncate(data.element.text, 15)}"` : '';
    return truncate(`${tag}${text}: ${request}`, 50);
  }

  return truncate(request, 50) || 'Edit';
}
