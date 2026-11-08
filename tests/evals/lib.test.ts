import { describe, expect, it } from 'vitest';
import { answersMatch, extractTagged, normaliseAnswer, parseEvaluationXml } from '../../evals/lib';
import { parseFrontmatter, parseNote, splitFrontmatter } from '../../evals/fixture-adapter';

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
