import { describe, expect, it } from 'vitest';
import { describeLink } from './links';

describe('Retraction Watch links (AC18a)', () => {
  it('dates a post from its address and reads its title from the address', () => {
    expect(describeLink('https://retractionwatch.com/2020/01/02/example-post-about-a-paper/', 1)).toEqual({
      href: 'https://retractionwatch.com/2020/01/02/example-post-about-a-paper/',
      source: 'Retraction Watch, Jan. 2, 2020',
      text: 'Example post about a paper',
      shared: null,
    });
  });

  it('says how many records link to a post about a batch', () => {
    expect(describeLink('http://retractionwatch.com/2021/11/14/publisher-retracts-a-batch/', 10855).shared).toBe(
      'Linked from 10,855 records',
    );
    expect(describeLink('http://retractionwatch.com/2021/11/14/x/', 2).shared).toBe('Linked from 2 records');
  });

  it('labels other Retraction Watch pages and other sites', () => {
    expect(describeLink('https://retractionwatch.com/retracted-coronavirus-covid-19-papers/', 3)).toMatchObject({
      source: 'Retraction Watch page',
      text: 'retractionwatch.com/retracted-coronavirus-covid-19-papers/',
    });
    expect(describeLink('https://www.example.org/news/1', undefined)).toMatchObject({ source: 'example.org', shared: null });
  });

  it('decodes an encoded address', () => {
    expect(describeLink('https://retractionwatch.com/2019/05/06/caf%C3%A9-study/', 1).text).toBe('Café study');
  });
});
