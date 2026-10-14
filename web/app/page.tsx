// Placeholder until the search page (spec 002, task 11). It shows the theme's
// notice-type and reason-group colors so they can be checked by eye.
const noticeTypes = [
  ['Retraction', 'bg-retraction text-retraction-ink border-retraction-line'],
  ['Expression of concern', 'bg-concern text-concern-ink border-concern-line'],
  ['Correction', 'bg-correction text-correction-ink border-correction-line'],
  ['Reinstatement', 'bg-reinstatement text-reinstatement-ink border-reinstatement-line'],
];

const reasonGroups = [
  ['Investigations', 'bg-reason-investigations text-reason-investigations-ink border-reason-investigations-line'],
  ['Notice and status', 'bg-reason-notice text-reason-notice-ink border-reason-notice-line'],
  ['Data and results', 'bg-reason-data text-reason-data-ink border-reason-data-line'],
  ['Images', 'bg-reason-images text-reason-images-ink border-reason-images-line'],
  ['Plagiarism, duplication and text', 'bg-reason-plagiarism text-reason-plagiarism-ink border-reason-plagiarism-line'],
  ['Peer review and publishing', 'bg-reason-review text-reason-review-ink border-reason-review-line'],
  ['Ethics, conduct and legal', 'bg-reason-ethics text-reason-ethics-ink border-reason-ethics-line'],
  ['Authorship and approval', 'bg-reason-authorship text-reason-authorship-ink border-reason-authorship-line'],
  ['Other', 'bg-reason-other text-reason-other-ink border-reason-other-line'],
];

export default function Home() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 min-[821px]:px-6">
      <main className="py-10">
        <h1 className="text-2xl font-bold">Retraction search</h1>
        <p className="mt-2 text-ink-600">The search page is being built.</p>

        <h2 className="mt-8 text-sm font-semibold text-ink-700">Notice types</h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {noticeTypes.map(([name, classes]) => (
            <li key={name} className={`rounded border px-2 text-xs font-bold leading-normal ${classes}`}>
              {name}
            </li>
          ))}
        </ul>

        <h2 className="mt-6 text-sm font-semibold text-ink-700">Reason groups</h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {reasonGroups.map(([name, classes]) => (
            <li key={name} className={`rounded border px-2 text-[13px] ${classes}`}>
              {name}
            </li>
          ))}
        </ul>
        <p className="mt-4 font-mono text-sm text-ink-600">Record 1 · 10.1002/jcb.23190</p>
      </main>
    </div>
  );
}
