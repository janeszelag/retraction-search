// Search text that is a DOI or a PubMed ID becomes an identifier lookup, which
// ignores the filters (spec 002 AC12).

export type IdentifierLookup = { kind: 'doi'; value: string } | { kind: 'pubmed'; value: number };

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function identifierLookup(q: string): IdentifierLookup | null {
  const text = q.trim();
  // DOIs are cleaned the way the pipeline cleans them: decoded and lowercased,
  // so a DOI matches in any case and with or without a doi.org prefix.
  const doi = decode(text)
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/, '');
  if (/^10\.\d+\/\S+$/.test(doi)) {
    return { kind: 'doi', value: doi };
  }
  const pubmed = text
    .replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?$/i, '$1')
    .replace(/^pmid:?\s*/i, '');
  if (/^\d{5,9}$/.test(pubmed)) {
    return { kind: 'pubmed', value: Number(pubmed) };
  }
  return null;
}
