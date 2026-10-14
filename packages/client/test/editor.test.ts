import { StringStream } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { unitScript } from '../src/editor';

/** Runs the editor's tokeniser over one line, returning [text, style] pairs. */
function tokens(line: string): [string, string | null][] {
  const state = unitScript.startState!(2);
  const stream = new StringStream(line, 2, 2);
  const out: [string, string | null][] = [];
  while (!stream.eol()) {
    const style = unitScript.token(stream, state);
    const text = stream.current();
    if (text.trim()) out.push([text, style]);
    stream.start = stream.pos;
  }
  return out;
}

describe('script editor highlighting', () => {
  it('classifies keywords, builtins, constants, definitions, numbers and comments', () => {
    expect(tokens('var target = -1  # comment')).toEqual([
      ['var', 'keyword'],
      ['target', 'definition'],
      ['=', 'operator'],
      ['-', 'operator'],
      ['1', 'number'],
      ['# comment', 'comment'],
    ]);
    expect(tokens('if taskFlags(0) & URGENT { foo = true }')).toEqual([
      ['if', 'keyword'],
      ['taskFlags', 'builtin'],
      ['(', 'bracket'],
      ['0', 'number'],
      [')', 'bracket'],
      ['&', 'operator'],
      ['URGENT', 'constant'],
      ['{', 'bracket'],
      ['foo', 'variableName'],
      ['=', 'operator'],
      ['true', 'bool'],
      ['}', 'bracket'],
    ]);
  });

  it('highlights button declarations', () => {
    expect(tokens('button boost "Boost" key "B" aim')).toEqual([
      ['button', 'keyword'],
      ['boost', 'definition'],
      ['"Boost"', 'string'],
      ['key', 'keyword'],
      ['"B"', 'string'],
      ['aim', 'keyword'],
    ]);
    // Outside a button line, `key` and `aim` are ordinary names.
    expect(tokens('aim = key')).toEqual([
      ['aim', 'variableName'],
      ['=', 'operator'],
      ['key', 'variableName'],
    ]);
  });
});
