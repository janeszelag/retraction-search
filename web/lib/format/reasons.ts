// Groups Retraction Watch's reasons for color (plan 002, "Visual values"). The
// grouping is this site's, not Retraction Watch's, and says nothing about
// severity; the Reason filter's note says so.

export type ReasonGroupId =
  | 'investigations'
  | 'notice'
  | 'data'
  | 'images'
  | 'plagiarism'
  | 'review'
  | 'ethics'
  | 'authorship'
  | 'other';

export interface ReasonGroup {
  id: ReasonGroupId;
  name: string;
  // Tailwind classes for the background, text and border, written out in full
  // so Tailwind finds them.
  classes: string;
}

type Rule = { startsWith: string } | { contains: string };

const has = (...texts: string[]): Rule[] => texts.map((text) => ({ contains: text }));

const GROUPS: Record<ReasonGroupId, ReasonGroup> = {
  investigations: {
    id: 'investigations',
    name: 'Investigations',
    classes: 'bg-reason-investigations text-reason-investigations-ink border-reason-investigations-line',
  },
  notice: {
    id: 'notice',
    name: 'Notice and status',
    classes: 'bg-reason-notice text-reason-notice-ink border-reason-notice-line',
  },
  data: { id: 'data', name: 'Data and results', classes: 'bg-reason-data text-reason-data-ink border-reason-data-line' },
  images: { id: 'images', name: 'Images', classes: 'bg-reason-images text-reason-images-ink border-reason-images-line' },
  plagiarism: {
    id: 'plagiarism',
    name: 'Plagiarism, duplication and text',
    classes: 'bg-reason-plagiarism text-reason-plagiarism-ink border-reason-plagiarism-line',
  },
  review: {
    id: 'review',
    name: 'Peer review and publishing',
    classes: 'bg-reason-review text-reason-review-ink border-reason-review-line',
  },
  ethics: {
    id: 'ethics',
    name: 'Ethics, conduct and legal',
    classes: 'bg-reason-ethics text-reason-ethics-ink border-reason-ethics-line',
  },
  authorship: {
    id: 'authorship',
    name: 'Authorship and approval',
    classes: 'bg-reason-authorship text-reason-authorship-ink border-reason-authorship-line',
  },
  other: { id: 'other', name: 'Other', classes: 'bg-reason-other text-reason-other-ink border-reason-other-line' },
};

// The plan's table, in order: the first group with a matching rule wins.
const RULES: [ReasonGroupId, Rule[]][] = [
  ['investigations', [{ startsWith: 'Investigation by' }]],
  [
    'notice',
    has(
      'Notice -',
      'Date of Article',
      'Removed',
      'Temporary Removal',
      'Update',
      'Retract and Replace',
      'EOC Lifted',
      'No Further Action',
      'Doing the Right Thing',
      'Nonpayment',
    ),
  ],
  ['data', [{ startsWith: 'Original Data' }]],
  ['images', has('Image')],
  [
    'plagiarism',
    has(
      'Plagiarism',
      'Duplication of/in Article',
      'Duplication of Text',
      'Euphemisms for Duplication',
      'Taken from',
      'Taken via',
      'Salami',
      'Referencing',
      'Cites Retracted',
      'Error in Text',
      'Copyright',
    ),
  ],
  [
    'review',
    [
      ...has('Peer Review', 'Paper Mill', 'Rogue Editor', 'Computer-Aided', 'Third Party Involvement', 'Hoax', 'by Journal/Publisher', 'Conference'),
      { startsWith: 'Withdrawn' },
    ],
  ],
  ['data', has('Data', 'Results', 'Analyses', 'Methods', 'Materials', 'Cell Lines', 'Reproducible', 'Contamination', 'Sabotage')],
  [
    'ethics',
    has(
      'IRB',
      'Consent',
      'Welfare',
      'Ethical',
      'Conflict of Interest',
      'Misconduct',
      'Bias',
      'Legal',
      'Civil',
      'Criminal',
      'Publishing Ban',
      'Euphemisms',
    ),
  ],
  ['authorship', has('Author', 'Affiliation', 'Approval', 'Objections', 'Complaints', 'Miscommunication')],
];

const matches = (reason: string, rule: Rule) =>
  'startsWith' in rule ? reason.startsWith(rule.startsWith) : reason.includes(rule.contains);

// A reason that matches no rule, such as a new one, lands in "Other".
export function reasonGroup(reason: string): ReasonGroup {
  const found = RULES.find(([, rules]) => rules.some((rule) => matches(reason, rule)));
  return GROUPS[found ? found[0] : 'other'];
}

export const REASON_GROUPS = Object.values(GROUPS);
