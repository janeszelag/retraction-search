import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The theme lives in globals.css, so the test reads the colors from there.
const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const colors = Object.fromEntries(
  [...css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, value]) => [name, value.toLowerCase()]),
);

// WCAG 2.2 contrast ratio between two colors.
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const noticeTypes = ['retraction', 'concern', 'correction', 'reinstatement'];
const reasonGroups = ['investigations', 'notice', 'data', 'images', 'plagiarism', 'review', 'ethics', 'authorship', 'other'].map(
  (group) => `reason-${group}`,
);

describe('theme', () => {
  it('holds the plan’s design values', () => {
    expect(colors['accent']).toBe('#1f5aa6');
    expect(colors['exclude']).toBe('#a84d17');
    expect(colors['ink-950']).toBe('#16191d');
    expect(colors['ink-25']).toBe('#f7f8fa');
    expect(css).toContain('--font-sans: var(--font-public-sans)');
    expect(css).toContain('--font-mono: var(--font-plex-mono)');
  });

  it.each([...noticeTypes, ...reasonGroups])('gives %s a background, text and border color', (name) => {
    for (const key of [name, `${name}-ink`, `${name}-line`]) {
      expect(colors[key], key).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each([...noticeTypes, ...reasonGroups])('gives %s text that meets WCAG AA contrast (4.5:1)', (name) => {
    expect(contrast(colors[`${name}-ink`], colors[name])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps everyday text readable on white', () => {
    for (const name of ['ink-950', 'ink-700', 'ink-600', 'accent', 'accent-dark', 'exclude', 'exclude-ink']) {
      expect(contrast(colors[name], '#ffffff'), name).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(colors['ink-950'], colors['highlight'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors['exclude-ink'], colors['exclude-soft'])).toBeGreaterThanOrEqual(4.5);
  });
});
