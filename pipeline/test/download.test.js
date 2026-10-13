import { describe, expect, it } from 'vitest';
import { dataDateFromCommit, rawFileUrl, snapshotBaseName } from '../src/download.js';

describe('download helpers', () => {
  it('takes the data date from the upstream commit title', () => {
    const commit = {
      title: 'Retraction Watch data for 2026-10-09',
      committed_date: '2026-10-09T23:00:11.000+00:00',
    };
    expect(dataDateFromCommit(commit)).toBe('2026-10-09');
  });

  it('falls back to the commit date when the title has no date', () => {
    const commit = { title: 'Update README', committed_date: '2026-10-12T08:30:00.000+00:00' };
    expect(dataDateFromCommit(commit)).toBe('2026-10-12');
  });

  it('names snapshots by data date and short commit', () => {
    expect(snapshotBaseName('2026-10-09', 'bc5648dd')).toBe('retraction_watch-2026-10-09-bc5648dd');
  });

  it('downloads the file at an exact commit', () => {
    expect(rawFileUrl('bc5648dda5e697cc08a5abb4eb005793ffe98425')).toBe(
      'https://gitlab.com/crossref/retraction-watch-data/-/raw/bc5648dda5e697cc08a5abb4eb005793ffe98425/retraction_watch.csv',
    );
  });
});
