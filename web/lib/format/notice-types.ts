// Each notice type's label colors. A label always shows the type's name, so
// the types are never told apart by color alone (spec 002 AC32).
const CLASSES: Record<string, string> = {
  Retraction: 'bg-retraction text-retraction-ink border-retraction-line',
  'Expression of concern': 'bg-concern text-concern-ink border-concern-line',
  Correction: 'bg-correction text-correction-ink border-correction-line',
  Reinstatement: 'bg-reinstatement text-reinstatement-ink border-reinstatement-line',
};

export function noticeTypeClasses(type: string): string {
  return CLASSES[type] ?? 'bg-ink-50 text-ink-900 border-ink-200';
}
