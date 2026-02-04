import { describe, it, expect } from 'vitest';
import { createSession, getAnnotationLabel } from './session';
import type { AnnotationData, MultiEditData } from './types';

describe('createSession', () => {
  it('creates a session with provided config values', () => {
    const session = createSession({ name: 'My App', path: '/projects/app', startCommand: 'npm run dev', shell: 'wsl' }, 1);
    expect(session.name).toBe('My App');
    expect(session.projectPath).toBe('/projects/app');
    expect(session.startCommand).toBe('npm run dev');
    expect(session.shell).toBe('wsl');
  });

  it('uses default values when config is null', () => {
    const session = createSession(null, 3);
    expect(session.name).toBe('Project 3');
    expect(session.projectPath).toBe('');
    expect(session.startCommand).toBe('');
    expect(session.shell).toBe('default');
  });

  it('creates one terminal tab named "Terminal 1"', () => {
    const session = createSession(null, 1);
    expect(session.terminalTabs).toHaveLength(1);
    expect(session.terminalTabs[0].name).toBe('Terminal 1');
  });

  it('sets the active terminal tab to the first tab', () => {
    const session = createSession(null, 1);
    expect(session.activeTerminalTabId).toBe(session.terminalTabs[0].id);
  });

  it('sets correct default property values', () => {
    const session = createSession(null, 1);
    expect(session.browserWidth).toBe(60);
    expect(session.terminalCollapsed).toBe(false);
    expect(session.url).toBe('http://localhost:3000');
    expect(session.terminalTabCounter).toBe(1);
    expect(session.devServerTabId).toBeNull();
    expect(session.cliToolTabId).toBeNull();
    expect(session.cliTool).toBeNull();
    expect(session.cliToolRunning).toBe(false);
  });

  it('generates unique IDs for each session', () => {
    const session1 = createSession(null, 1);
    const session2 = createSession(null, 2);
    expect(session1.id).not.toBe(session2.id);
  });

  it('formats terminal tab ID as sessionId-1', () => {
    const session = createSession(null, 1);
    expect(session.terminalTabs[0].id).toBe(`${session.id}-1`);
  });

  it('uses default shell when config.shell is undefined', () => {
    const session = createSession({ name: 'Test', path: '', startCommand: '' }, 1);
    expect(session.shell).toBe('default');
  });
});

describe('getAnnotationLabel', () => {
  function makeAnnotationData(overrides: Partial<AnnotationData> = {}): AnnotationData {
    return {
      url: 'http://localhost:3000',
      sessionId: 'test',
      element: { tagName: 'div', selector: 'div' },
      request: 'fix it',
      ...overrides,
    };
  }

  it('returns edit count for multi-edit data', () => {
    const data = {
      url: 'http://localhost:3000',
      sessionId: 'test',
      annotations: [
        { selector: 'div', tagName: 'div', bounds: { x: 0, y: 0, width: 100, height: 50 }, note: 'a' },
        { selector: 'span', tagName: 'span', bounds: { x: 0, y: 0, width: 100, height: 50 }, note: 'b' },
        { selector: 'p', tagName: 'p', bounds: { x: 0, y: 0, width: 100, height: 50 }, note: 'c' },
      ],
    } as unknown as AnnotationData;
    expect(getAnnotationLabel(data)).toBe('3 edits');
  });

  it('formats text selection label', () => {
    const data = makeAnnotationData({ selectedText: 'hello world', request: 'fix typo' });
    expect(getAnnotationLabel(data)).toBe('"hello world": fix typo');
  });

  it('truncates long selected text to 20 chars', () => {
    const data = makeAnnotationData({
      selectedText: 'this is a very long selected text string',
      request: 'fix',
    });
    const label = getAnnotationLabel(data);
    expect(label).toContain('...');
    expect(label).toBe('"this is a very long ...": fix');
  });

  it('formats multi-select label with element count', () => {
    const data = makeAnnotationData({
      elements: [
        { tagName: 'div', selector: 'div' },
        { tagName: 'span', selector: 'span' },
      ],
      request: 'align them',
    });
    expect(getAnnotationLabel(data)).toBe('2 elements: align them');
  });

  it('formats single element label with tag name', () => {
    const data = makeAnnotationData({
      element: { tagName: 'DIV', selector: 'div' },
      request: 'style it',
    });
    expect(getAnnotationLabel(data)).toBe('<div>: style it');
  });

  it('includes element text in label', () => {
    const data = makeAnnotationData({
      element: { tagName: 'button', text: 'Click me', selector: 'button' },
      request: 'change color',
    });
    expect(getAnnotationLabel(data)).toBe('<button> "Click me": change color');
  });

  it('truncates overall label to 50 chars', () => {
    const data = makeAnnotationData({
      element: { tagName: 'div', selector: 'div' },
      request: 'this is a very long request that should be truncated at fifty characters limit',
    });
    const label = getAnnotationLabel(data);
    expect(label.length).toBeLessThanOrEqual(53); // 50 + "..."
    expect(label).toContain('...');
  });

  it('returns "Edit" for empty request with no distinguishing data', () => {
    const data = makeAnnotationData({ element: undefined as never, request: '' });
    // When element is undefined and request is empty, falls through to last return
    expect(getAnnotationLabel(data)).toBe('Edit');
  });

  it('uses request text as fallback when no element data', () => {
    const data = {
      url: 'http://localhost:3000',
      sessionId: 'test',
      request: 'do something',
    } as unknown as AnnotationData;
    expect(getAnnotationLabel(data)).toBe('do something');
  });
});
