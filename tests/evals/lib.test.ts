import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { answersMatch, extractTagged, loadDotEnv, normaliseAnswer, parseEvaluationXml } from '../../evals/lib';
import {
  FixtureAdapter,
  parseFrontmatter,
  parseNote,
  splitFrontmatter,
} from '../../evals/fixture-adapter';

describe('parseEvaluationXml', () => {
  it('reads qa_pairs in order, trimmed and entity-decoded', () => {
    const xml = `<!-- comment with <qa_pair> inside -->
<evaluation>
  <qa_pair>
    <question>  What is &lt;b&gt; &amp; c?  </question>
    <answer>A &amp; B</answer>
  </qa_pair>
  <qa_pair><question>Second?</question><answer><![CDATA[x &amp; y]]></answer></qa_pair>
</evaluation>`;
    expect(parseEvaluationXml(xml)).toEqual([
      { question: 'What is <b> & c?', answer: 'A & B' },
      { question: 'Second?', answer: 'x &amp; y' },
    ]);
  });

  it('strips comments that only appear after a first stripping pass', () => {
    const xml = `<evaluation>
  <!<!-- x -->-- <qa_pair><question>Hidden?</question><answer>no</answer></qa_pair> -->
  <qa_pair><question>Real?</question><answer>yes</answer></qa_pair>
</evaluation>`;
    expect(parseEvaluationXml(xml)).toEqual([{ question: 'Real?', answer: 'yes' }]);
  });

  it('rejects a qa_pair without an answer', () => {
    expect(() =>
      parseEvaluationXml('<evaluation><qa_pair><question>Q</question></qa_pair></evaluation>'),
    ).toThrow(/qa_pair #1/);
  });

  it('rejects a file without an <evaluation> root', () => {
    expect(() => parseEvaluationXml('<qa_pair/>')).toThrow(/evaluation/);
  });
});

describe('extractTagged', () => {
  it('returns the last occurrence, trimmed', () => {
    expect(extractTagged('<response>a</response> then <response> b \n</response>', 'response')).toBe('b');
  });

  it('returns null when the tag is missing', () => {
    expect(extractTagged('no tags here', 'response')).toBeNull();
  });
});

describe('normaliseAnswer / answersMatch', () => {
  it.each([
    ['Field Technician', 'field technician'],
    ['  "Lena   Fischer". ', 'lena fischer'],
    ['**`Beacon`**', 'beacon'],
    ['Ｂｅａｃｏｎ', 'beacon'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normaliseAnswer(input)).toBe(expected);
  });

  it('matches equal strings after normalisation', () => {
    expect(answersMatch('pressure sensors.', 'Pressure sensors')).toBe(true);
    expect(answersMatch('Pressure sensor', 'Pressure sensors')).toBe(false);
  });

  it('compares plain numbers by value', () => {
    expect(answersMatch('5.40', '5.4')).toBe(true);
    expect(answersMatch('042000', '42000')).toBe(true);
    expect(answersMatch('42,000', '42000')).toBe(false);
  });

  it('fails a missing answer', () => {
    expect(answersMatch(null, 'x')).toBe(false);
  });
});

describe('fixture note parsing', () => {
  it('splits and parses simple YAML frontmatter, keeping dates as strings', () => {
    const { yaml, body } = splitFrontmatter('---\nstatus: active\nstarted: 2026-02-10\n---\n# T\n');
    expect(body).toBe('# T\n');
    expect(parseFrontmatter(yaml ?? '')).toEqual({ status: 'active', started: '2026-02-10' });
    expect(parseFrontmatter('n: 3\nflag: true\nq: "x: y"\nlist: [a, b]\nblock:\n  - one\n  - two')).toEqual({
      n: 3,
      flag: true,
      q: 'x: y',
      list: ['a', 'b'],
      block: ['one', 'two'],
    });
  });

  it('extracts headings, inline tags, links, aliases and embeds outside code fences', () => {
    const note = parseNote(
      [
        '---',
        'status: x',
        '---',
        '# Title',
        'Text #tag-one and #nested/tag but not #123 or a#b.',
        'See [[Other]] and [[Deep#Part|alias]].',
        '![[Doc#^block]]',
        '```',
        '# not a heading [[NotALink]] #nottag',
        '```',
        '## Sub ##',
      ].join('\n'),
    );
    expect(note.frontmatter).toEqual({ status: 'x' });
    expect(note.headings).toEqual([
      { heading: 'Title', level: 1 },
      { heading: 'Sub', level: 2 },
    ]);
    expect(note.tags).toEqual(['#tag-one', '#nested/tag']);
    expect(note.links).toEqual([
      { link: 'Other', displayText: 'Other' },
      { link: 'Deep#Part', displayText: 'alias' },
    ]);
    expect(note.embeds).toEqual([{ link: 'Doc#^block', displayText: 'Doc#^block' }]);
  });
});

describe('FixtureAdapter.getBacklinks', () => {
  it('lists notes that link to the path by basename', () => {
    const adapter = new FixtureAdapter();
    adapter.addNote('projects/Atlas.md', '# Atlas\n');
    adapter.addNote('log.md', 'See [[Atlas]].\n');
    expect(adapter.getBacklinks('projects/Atlas.md')).toEqual(['log.md']);
  });

  it('fails with "File not found" for a missing path, like the real adapter (#463)', () => {
    const adapter = new FixtureAdapter();
    adapter.addNote('log.md', 'See [[Atlas]].\n');
    expect(() => adapter.getBacklinks('missing.md')).toThrow('File not found: missing.md');
    expect(() => adapter.getBacklinkLines('missing.md')).toThrow('File not found: missing.md');
  });
});

describe('loadDotEnv', () => {
  it('loads a .env file without overriding variables that are already set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-env-'));
    try {
      const path = join(dir, '.env');
      writeFileSync(
        path,
        '# Mistral\nEVAL_BASE_URL=https://api.mistral.ai/v1\nEVAL_MODEL="mistral-large-latest"\nEVAL_API_KEY=from-file\n',
      );
      const env: NodeJS.ProcessEnv = { EVAL_API_KEY: 'from-shell' };
      expect(loadDotEnv(path, env).sort()).toEqual(['EVAL_BASE_URL', 'EVAL_MODEL']);
      expect(env).toEqual({
        EVAL_API_KEY: 'from-shell',
        EVAL_BASE_URL: 'https://api.mistral.ai/v1',
        EVAL_MODEL: 'mistral-large-latest',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does nothing when there is no .env file', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(loadDotEnv(join(tmpdir(), 'no-such-dir-483', '.env'), env)).toEqual([]);
    expect(env).toEqual({});
  });
});
