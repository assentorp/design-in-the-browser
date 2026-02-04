import { describe, it, expect } from 'vitest';
import { formatAnnotationPrompt, formatMultiEditPrompt } from './format-prompt';
import type { AnnotationData } from './types';

function makeAnnotationData(overrides: Partial<AnnotationData> = {}): AnnotationData {
  return {
    url: 'http://localhost:3000',
    sessionId: 'test-session',
    element: { tagName: 'div', selector: 'div' },
    request: 'make it red',
    ...overrides,
  };
}

describe('formatAnnotationPrompt', () => {
  it('formats a single element annotation', () => {
    const data = makeAnnotationData({ element: { tagName: 'div', selector: 'div' }, request: 'make it red' });
    expect(formatAnnotationPrompt(data)).toBe('- <div>: make it red');
  });

  it('includes element text content', () => {
    const data = makeAnnotationData({
      element: { tagName: 'button', text: 'Click me', selector: 'button' },
      request: 'change color',
    });
    expect(formatAnnotationPrompt(data)).toBe('- <button> "Click me": change color');
  });

  it('includes element attributes', () => {
    const data = makeAnnotationData({
      element: { tagName: 'input', attributes: 'type=text', selector: 'input' },
      request: 'add placeholder',
    });
    expect(formatAnnotationPrompt(data)).toBe('- <input> [type=text]: add placeholder');
  });

  it('includes both text and attributes', () => {
    const data = makeAnnotationData({
      element: { tagName: 'input', text: 'Name', attributes: 'type=text', selector: 'input' },
      request: 'style it',
    });
    expect(formatAnnotationPrompt(data)).toBe('- <input> "Name" [type=text]: style it');
  });

  it('formats text selection annotations', () => {
    const data = makeAnnotationData({
      selectedText: 'selected text',
      request: 'fix typo',
    });
    expect(formatAnnotationPrompt(data)).toBe('- "selected text": fix typo');
  });

  it('formats multi-select element annotations', () => {
    const data = makeAnnotationData({
      elements: [
        { tagName: 'div', selector: '.header', displaySelector: '.header' },
        { tagName: 'div', selector: '.footer', displaySelector: '.footer' },
      ],
      request: 'align them',
    });
    expect(formatAnnotationPrompt(data)).toBe('- .header, .footer: align them');
  });

  it('uses tagName fallback for multi-select without displaySelector', () => {
    const data = makeAnnotationData({
      elements: [
        { tagName: 'div', selector: 'div' },
        { tagName: 'span', selector: 'span' },
      ],
      request: 'style both',
    });
    expect(formatAnnotationPrompt(data)).toBe('- <div>, <span>: style both');
  });

  it('appends screenshot path', () => {
    const data = makeAnnotationData();
    const result = formatAnnotationPrompt(data, '/tmp/screenshot.png');
    expect(result).toBe('- <div>: make it red (see element screenshot: /tmp/screenshot.png)');
  });

  it('appends reference image path', () => {
    const data = makeAnnotationData();
    const result = formatAnnotationPrompt(data, undefined, '/tmp/reference.png');
    expect(result).toBe('- <div>: make it red (see reference image: /tmp/reference.png)');
  });

  it('appends both screenshot and reference image paths', () => {
    const data = makeAnnotationData();
    const result = formatAnnotationPrompt(data, '/tmp/screenshot.png', '/tmp/reference.png');
    expect(result).toBe('- <div>: make it red (see element screenshot: /tmp/screenshot.png) (see reference image: /tmp/reference.png)');
  });

  it('prioritizes selectedText over elements and single element', () => {
    const data = makeAnnotationData({
      selectedText: 'hello',
      elements: [{ tagName: 'div', selector: 'div' }, { tagName: 'span', selector: 'span' }],
      request: 'fix',
    });
    expect(formatAnnotationPrompt(data)).toBe('- "hello": fix');
  });
});

describe('formatMultiEditPrompt', () => {
  it('formats a single annotation', () => {
    const annotations = [{ selector: 'div', tagName: 'div', note: 'make red', screenshot: '' }];
    expect(formatMultiEditPrompt(annotations, [''])).toBe('- <div>: make red');
  });

  it('formats multiple annotations separated by newlines', () => {
    const annotations = [
      { selector: 'div', tagName: 'div', note: 'make red' },
      { selector: 'span', tagName: 'span', note: 'make blue' },
    ];
    const result = formatMultiEditPrompt(annotations, ['', '']);
    expect(result).toBe('- <div>: make red\n- <span>: make blue');
  });

  it('includes text content in annotation line', () => {
    const annotations = [{ selector: 'button', tagName: 'button', text: 'Submit', note: 'change color' }];
    expect(formatMultiEditPrompt(annotations, [''])).toBe('- <button> "Submit": change color');
  });

  it('appends screenshot paths', () => {
    const annotations = [{ selector: 'div', tagName: 'div', note: 'make red' }];
    const result = formatMultiEditPrompt(annotations, ['/tmp/shot.png']);
    expect(result).toBe('- <div>: make red (see screenshot: /tmp/shot.png)');
  });

  it('handles mixed screenshots (some present, some empty)', () => {
    const annotations = [
      { selector: 'div', tagName: 'div', note: 'first edit' },
      { selector: 'span', tagName: 'span', note: 'second edit' },
    ];
    const result = formatMultiEditPrompt(annotations, ['/tmp/shot1.png', '']);
    expect(result).toBe('- <div>: first edit (see screenshot: /tmp/shot1.png)\n- <span>: second edit');
  });
});
