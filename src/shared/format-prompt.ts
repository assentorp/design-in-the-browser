import type { AnnotationData } from './types';

export interface MultiEditAnnotation {
  selector: string;
  tagName: string;
  text?: string;
  attributes?: string;
  note: string;
  screenshot?: string;
}

export function formatAnnotationPrompt(data: AnnotationData, screenshotPath?: string, referenceImagePaths?: string[]): string {
  const { element, request, selectedText, elements } = data;

  let prompt: string;

  // Handle text selection annotations
  if (selectedText) {
    prompt = `- "${selectedText}": ${request}`;
  }
  // Handle multi-select annotations
  else if (elements && elements.length > 1) {
    const displaySelectors = elements.map(e => e.displaySelector || `<${e.tagName}>`).join(', ');
    prompt = `- ${displaySelectors}: ${request}`;
  }
  // Handle single element annotations
  else {
    const parts = [`<${element.tagName}>`];
    if (element.text) parts.push(`"${element.text}"`);
    if (element.attributes) parts.push(`[${element.attributes}]`);
    prompt = `- ${parts.join(' ')}: ${request}`;
  }

  // Add screenshot path for Claude to read
  if (screenshotPath) {
    prompt += ` (see element screenshot: ${screenshotPath})`;
  }

  // Add reference image paths for Claude to read. Numbered like Claude Code's
  // attachments so the note can say e.g. "make it look like [Image #2]".
  if (referenceImagePaths && referenceImagePaths.length === 1) {
    prompt += ` (see reference image: ${referenceImagePaths[0]})`;
  } else if (referenceImagePaths && referenceImagePaths.length > 1) {
    const labeled = referenceImagePaths.map((p, i) => `[Image #${i + 1}]: ${p}`);
    prompt += ` (reference images — ${labeled.join(', ')})`;
  }

  return prompt;
}

export function formatMultiEditPrompt(annotations: MultiEditAnnotation[], screenshotPaths: string[]): string {
  const parts: string[] = [];

  for (let i = 0; i < annotations.length; i++) {
    const ann = annotations[i];
    const screenshot = screenshotPaths[i];

    let line = `- <${ann.tagName}>`;
    if (ann.text) line += ` "${ann.text}"`;
    line += `: ${ann.note}`;
    if (screenshot) line += ` (see screenshot: ${screenshot})`;

    parts.push(line);
  }

  return parts.join('\n');
}
