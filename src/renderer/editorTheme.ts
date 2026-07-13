import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

// CodeMirror theme matching the app's design language: One Dark's familiar
// syntax palette rendered on the app's own neutral surfaces, with the
// #c6613f accent for caret, selection, and search highlights.

const accent = '#c6613f';

const colors = {
  background: '#1a1a1a', // --bg-primary
  text: '#abb2bf',
  comment: '#5c6370',
  keyword: '#c678dd', // purple
  string: '#98c379', // green
  number: '#d19a66', // orange
  func: '#61afef', // blue
  type: '#e5c07b', // yellow
  tag: '#e06c75', // red
  cyan: '#56b6c2',
  invalid: '#e5484d',
};

const appHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: colors.comment, fontStyle: 'italic' },
  {
    tag: [t.keyword, t.moduleKeyword, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.self],
    color: colors.keyword,
  },
  { tag: [t.string, t.special(t.string)], color: colors.string },
  { tag: [t.regexp, t.escape], color: colors.cyan },
  { tag: [t.number, t.bool, t.null, t.atom], color: colors.number },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: colors.func },
  { tag: [t.typeName, t.className, t.namespace], color: colors.type },
  { tag: [t.propertyName, t.attributeName], color: colors.tag },
  { tag: t.tagName, color: colors.tag },
  { tag: [t.operator, t.punctuation, t.bracket, t.meta], color: colors.text },
  { tag: t.variableName, color: colors.tag },
  { tag: t.definition(t.variableName), color: colors.text },
  { tag: t.invalid, color: colors.invalid },
  { tag: t.link, color: colors.func, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: colors.tag },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
]);

const appTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '13px',
      backgroundColor: colors.background,
      color: colors.text,
    },
    '.cm-scroller': {
      fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
    },
    '.cm-content': { caretColor: accent },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: accent },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: 'rgba(198, 97, 63, 0.22)' },
    '.cm-selectionMatch': { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(198, 97, 63, 0.2)',
      outline: '1px solid rgba(198, 97, 63, 0.4)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(198, 97, 63, 0.4)' },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: 'rgba(198, 97, 63, 0.18)' },
    '.cm-gutters': {
      backgroundColor: colors.background,
      color: '#4d5361',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.04)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
      color: '#8a919e',
    },
    '.cm-foldPlaceholder': {
      background: '#2a2a2a', // --bg-tertiary
      border: '1px solid #333',
      color: '#888',
    },
    '.cm-tooltip': {
      background: '#242424', // --bg-secondary
      border: '1px solid #333',
      color: '#e5e5e5',
    },
    '.cm-panels': { background: '#242424', color: '#e5e5e5' },
  },
  { dark: true },
);

export const appEditorTheme: Extension[] = [appTheme, syntaxHighlighting(appHighlightStyle)];
