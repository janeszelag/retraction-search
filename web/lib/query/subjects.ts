// Retraction Watch's subject groups, by code. Names from its user guide's
// "Appendix A: Fields" (checked 2026-10-13).
export const SUBJECT_CATEGORIES: Record<string, string> = {
  BLS: 'Basic Life Sciences',
  'B/T': 'Business and Technology',
  ENV: 'Environmental Sciences',
  HSC: 'Health Sciences',
  HUM: 'Humanities',
  PHY: 'Physical Sciences',
  SOC: 'Social Sciences',
};

// A subject filter value is a category code ("BLS") or a subject with its code ("BLS: Neuroscience").
export type SubjectValue = { kind: 'category'; code: string } | { kind: 'subject'; code: string; name: string };

export function parseSubjectValue(value: string): SubjectValue {
  const match = /^([^:]+): (.+)$/.exec(value);
  return match ? { kind: 'subject', code: match[1], name: match[2] } : { kind: 'category', code: value };
}

// "Basic Life Sciences (BLS)", or the code alone for a code the guide doesn't list.
export function categoryLabel(code: string): string {
  const name = SUBJECT_CATEGORIES[code];
  return name ? `${name} (${code})` : code;
}

// "Neuroscience (BLS)" or "Basic Life Sciences (BLS)".
export function subjectLabel(value: string): string {
  const subject = parseSubjectValue(value);
  return subject.kind === 'subject' ? `${subject.name} (${subject.code})` : categoryLabel(subject.code);
}
