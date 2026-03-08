'use client';

import { useMemo, useState } from 'react';

type DictionaryDefinition = {
  definition: string;
  example?: string;
  synonyms?: string[];
};

type DictionaryMeaning = {
  partOfSpeech: string;
  definitions: DictionaryDefinition[];
  synonyms?: string[];
};

type DictionaryPhonetic = {
  text?: string;
  audio?: string;
};

type DictionaryEntry = {
  word: string;
  phonetic?: string;
  phonetics?: DictionaryPhonetic[];
  meanings: DictionaryMeaning[];
};

type DatamuseWord = {
  word: string;
  score?: number;
};

type SearchResult = {
  searchedText: string;
  displayWord: string;
  phonetic: string;
  meanings: Array<{
    partOfSpeech: string;
    definitions: string[];
    examples: string[];
    synonyms: string[];
  }>;
  allSynonyms: string[];
  wordForms: string[];
  strongerChoices: Array<{ phrase: string; replacement: string }>;
};

const VERY_REPLACEMENTS: Record<string, string> = {
  good: 'excellent',
  bad: 'awful',
  big: 'enormous',
  small: 'tiny',
  tired: 'exhausted',
  happy: 'delighted',
  sad: 'heartbroken',
  hungry: 'starving',
  cold: 'freezing',
  hot: 'scorching',
  angry: 'furious',
  scared: 'terrified',
  clean: 'spotless',
  dirty: 'filthy',
  funny: 'hilarious',
  pretty: 'beautiful',
  ugly: 'hideous',
  smart: 'brilliant',
  stupid: 'idiotic',
  loud: 'deafening',
  quiet: 'silent',
  fast: 'rapid',
  slow: 'sluggish',
};

const SAMPLE_SEARCHES = ['good', 'happiness', 'said', 'very tired', 'beautiful'];

function normalizeInput(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function uniqueWords(words: string[]) {
  return Array.from(
    new Set(
      words
        .map((word) => word.trim())
        .filter(Boolean)
        .filter((word) => /^[a-zA-Z][a-zA-Z\- ]*$/.test(word))
    )
  );
}

function titleCase(text: string) {
  return text.replace(/\b\w/g, (match) => match.toUpperCase());
}

function extractWordForms(entryWord: string, meanings: DictionaryMeaning[]) {
  const forms = new Set<string>();
  forms.add(entryWord);

  meanings.forEach((meaning) => {
    meaning.synonyms?.forEach((word) => forms.add(word));
    meaning.definitions.forEach((definition) => {
      definition.synonyms?.forEach((word) => forms.add(word));
    });
  });

  return uniqueWords(Array.from(forms)).slice(0, 12);
}

function buildVeryChoices(input: string, synonyms: string[]) {
  const cleaned = normalizeInput(input);
  if (!cleaned.startsWith('very ')) return [];

  const baseWord = cleaned.replace(/^very\s+/, '').trim();
  const choices: Array<{ phrase: string; replacement: string }> = [];

  if (VERY_REPLACEMENTS[baseWord]) {
    choices.push({
      phrase: `very ${baseWord}`,
      replacement: VERY_REPLACEMENTS[baseWord],
    });
  }

  synonyms.slice(0, 6).forEach((synonym) => {
    if (synonym.toLowerCase() !== baseWord.toLowerCase()) {
      choices.push({
        phrase: `very ${baseWord}`,
        replacement: synonym,
      });
    }
  });

  return choices.filter(
    (item, index, array) =>
      array.findIndex(
        (entry) => entry.replacement.toLowerCase() === item.replacement.toLowerCase()
      ) === index
  );
}

async function fetchDictionaryEntries(term: string): Promise<DictionaryEntry[]> {
  const response = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`
  );

  if (!response.ok) {
    throw new Error('Dictionary lookup failed.');
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('No dictionary entry found.');
  }

  return data as DictionaryEntry[];
}

async function fetchDatamuseSynonyms(term: string): Promise<string[]> {
  const response = await fetch(
    `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(term)}&max=12`
  );

  if (!response.ok) {
    throw new Error('Synonym lookup failed.');
  }

  const data = (await response.json()) as DatamuseWord[];
  return uniqueWords(data.map((item) => item.word)).slice(0, 12);
}

async function buildSearchResult(rawInput: string): Promise<SearchResult> {
  const cleaned = normalizeInput(rawInput);
  if (!cleaned) {
    throw new Error('Please type a word or phrase.');
  }

  const isVeryPhrase = cleaned.startsWith('very ');
  const lookupWord = isVeryPhrase ? cleaned.replace(/^very\s+/, '').trim() : cleaned;

  const [dictionaryEntries, datamuseSynonyms] = await Promise.all([
    fetchDictionaryEntries(lookupWord),
    fetchDatamuseSynonyms(lookupWord).catch(() => []),
  ]);

  const primaryEntry = dictionaryEntries[0];
  if (!primaryEntry || !primaryEntry.meanings?.length) {
    throw new Error('No useful result found.');
  }

  const phonetic =
    primaryEntry.phonetic || primaryEntry.phonetics?.find((item) => item.text)?.text || '';

  const meanings = primaryEntry.meanings.map((meaning) => {
    const definitionTexts = meaning.definitions
      .map((item) => item.definition)
      .filter(Boolean)
      .slice(0, 3);

    const exampleTexts = meaning.definitions
      .map((item) => item.example)
      .filter((example): example is string => Boolean(example))
      .slice(0, 3);

    const localSynonyms = uniqueWords([
      ...(meaning.synonyms || []),
      ...meaning.definitions.flatMap((item) => item.synonyms || []),
      ...datamuseSynonyms,
    ]).slice(0, 10);

    return {
      partOfSpeech: meaning.partOfSpeech,
      definitions: definitionTexts,
      examples: exampleTexts,
      synonyms: localSynonyms,
    };
  });

  const allSynonyms = uniqueWords([
    ...datamuseSynonyms,
    ...primaryEntry.meanings.flatMap((meaning) => meaning.synonyms || []),
    ...primaryEntry.meanings.flatMap((meaning) =>
      meaning.definitions.flatMap((definition) => definition.synonyms || [])
    ),
  ]).slice(0, 16);

  const wordForms = extractWordForms(primaryEntry.word, primaryEntry.meanings);
  const strongerChoices = buildVeryChoices(cleaned, allSynonyms);

  return {
    searchedText: rawInput.trim(),
    displayWord: primaryEntry.word,
    phonetic,
    meanings,
    allSynonyms,
    wordForms,
    strongerChoices,
  };
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-[28px] border border-white/70 bg-white/80 shadow-lg backdrop-blur-sm ${className}`}>{children}</div>;
}

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${className}`}>{children}</span>;
}

export default function Page() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const summaryText = useMemo(() => {
    if (!result) return '';

    const lines: string[] = [];
    lines.push(`Search: ${result.searchedText}`);
    lines.push(`Main word: ${result.displayWord}`);
    if (result.phonetic) lines.push(`Phonetic: ${result.phonetic}`);
    lines.push('');

    result.meanings.forEach((meaning) => {
      lines.push(`${titleCase(meaning.partOfSpeech)}`);
      meaning.definitions.forEach((definition) => lines.push(`- Definition: ${definition}`));
      meaning.examples.forEach((example) => lines.push(`- Example: ${example}`));
      if (meaning.synonyms.length) lines.push(`- Synonyms: ${meaning.synonyms.join(', ')}`);
      lines.push('');
    });

    if (result.wordForms.length) {
      lines.push(`Word forms / related forms: ${result.wordForms.join(', ')}`);
      lines.push('');
    }

    if (result.strongerChoices.length) {
      lines.push('Better than “very...” choices:');
      result.strongerChoices.forEach((item) => {
        lines.push(`- ${item.phrase} -> ${item.replacement}`);
      });
    }

    return lines.join('\n');
  }, [result]);

  async function handleSearch() {
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const nextResult = await buildSearchResult(input);
      setResult(nextResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong while searching.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setInput('');
    setResult(null);
    setError('');
  }

  function handleDownload() {
    if (!summaryText) return;
    downloadTextFile(`${result?.displayWord || 'word-results'}.txt`, summaryText);
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-rose-50 via-purple-50 to-sky-50 p-6 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-3 rounded-[28px] border border-white/70 bg-white/70 p-6 shadow-lg backdrop-blur-sm">
          <div className="inline-flex rounded-full bg-rose-100 px-4 py-1 text-sm font-medium text-rose-700">
            Vocabulary Support
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-800">Word Upgrade Tool</h1>
          <p className="max-w-3xl text-sm text-slate-600 md:text-base">
            Type your word or phrase to get stronger choices, definitions, word forms, and example sentences.
          </p>
        </div>

        <Card>
          <div className="space-y-4 p-6">
            <div className="flex flex-col gap-3 md:flex-row">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Try: good, happiness, said, very tired, beautiful"
                className="h-12 flex-1 rounded-2xl border border-rose-100 bg-white/90 px-4 text-slate-700 outline-none placeholder:text-slate-400"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch();
                }}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSearch}
                  disabled={loading}
                  className="h-12 rounded-2xl bg-rose-300 px-5 text-slate-800 hover:bg-rose-200 disabled:opacity-60"
                >
                  {loading ? 'Searching...' : 'Search'}
                </button>
                <button
                  onClick={handleReset}
                  className="h-12 rounded-2xl border border-violet-200 bg-violet-50 px-5 text-slate-700 hover:bg-violet-100"
                >
                  Reset
                </button>
                <button
                  onClick={handleDownload}
                  disabled={!result}
                  className="h-12 rounded-2xl bg-sky-100 px-5 text-slate-700 hover:bg-sky-200 disabled:opacity-60"
                >
                  Download
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {SAMPLE_SEARCHES.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => setInput(sample)}
                  className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-sm text-rose-700 transition hover:bg-rose-100"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {error && (
          <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-rose-50">
            <div className="p-6">
              <p className="font-semibold text-slate-800">{error}</p>
              <p className="mt-1 text-sm text-slate-600">
                Try a simpler word, singular form, or a phrase like “very tired.”
              </p>
            </div>
          </Card>
        )}

        {result && (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <div className="space-y-4 p-6 text-sm md:text-base">
                  <div className="flex flex-wrap items-center gap-3 text-2xl capitalize text-slate-800">
                    <span>{result.displayWord}</span>
                    <Badge className="bg-violet-100 text-violet-700">API Result</Badge>
                    {result.phonetic && <Badge className="bg-sky-100 text-sky-700">{result.phonetic}</Badge>}
                  </div>

                  <div>
                    <h3 className="mb-2 font-semibold text-slate-800">Synonyms</h3>
                    <div className="flex flex-wrap gap-2">
                      {result.allSynonyms.length ? (
                        result.allSynonyms.map((word) => (
                          <Badge key={word} className="border border-rose-200 bg-rose-50 text-rose-700">
                            {word}
                          </Badge>
                        ))
                      ) : (
                        <p className="text-slate-500">No synonym suggestions were returned.</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-2 font-semibold text-slate-800">Word Forms / Related Forms</h3>
                    <div className="flex flex-wrap gap-2">
                      {result.wordForms.map((word) => (
                        <Badge key={word} className="border border-violet-200 bg-violet-50 text-violet-700">
                          {word}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <div className="space-y-4 p-6 text-sm md:text-base">
                  <h2 className="text-xl font-semibold text-slate-800">Definitions and Examples</h2>
                  {result.meanings.map((meaning, index) => (
                    <div
                      key={`${meaning.partOfSpeech}-${index}`}
                      className="rounded-2xl border border-slate-100 bg-white/90 p-4 shadow-sm"
                    >
                      <p className="mb-2 font-semibold capitalize text-slate-800">{meaning.partOfSpeech}</p>

                      <div className="space-y-2">
                        {meaning.definitions.map((definition) => (
                          <p key={definition} className="text-slate-600">
                            <span className="font-medium text-slate-800">Definition:</span> {definition}
                          </p>
                        ))}
                      </div>

                      <div className="mt-3 space-y-2">
                        {meaning.examples.length ? (
                          meaning.examples.map((example) => (
                            <p key={example} className="text-slate-600">
                              <span className="font-medium text-slate-800">Example:</span> {example}
                            </p>
                          ))
                        ) : (
                          <p className="text-slate-500">No example sentences were returned for this part of speech.</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {result.strongerChoices.length > 0 && (
              <Card>
                <div className="p-6">
                  <h2 className="mb-4 text-xl font-semibold text-slate-800">Better Than “Very...”</h2>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {result.strongerChoices.map((item) => (
                      <div
                        key={`${item.phrase}-${item.replacement}`}
                        className="rounded-2xl border border-rose-100 bg-gradient-to-br from-white to-rose-50 p-4 shadow-sm"
                      >
                        <p className="text-sm text-slate-500">Instead of</p>
                        <p className="font-semibold text-slate-800">{item.phrase}</p>
                        <p className="mt-2 text-sm text-slate-500">Use</p>
                        <p className="text-lg font-bold text-slate-800">{item.replacement}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </main>
  );
}
