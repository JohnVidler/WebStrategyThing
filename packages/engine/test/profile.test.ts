import { describe, expect, it } from 'vitest';
import {
  compileProgram,
  cpuProfile,
  createFlow,
  EventId,
  FLOW_HOST,
  HARVESTER_CLASS,
  parseText,
  profileFlow,
  raise,
  runFlow,
  SCOUT_CLASS,
  serialize,
  testRun,
  type FlowHost,
  type HostApi,
} from '../src';

const api: HostApi<null> = [{ name: 'act', argc: 1, kind: 'action', cost: 5, fn: () => 0 }];
const host: FlowHost = { api, constants: new Map() };
const compile = (src: string) => {
  const { doc, errors } = parseText(src, host);
  expect(errors.map((e) => e.message)).toEqual([]);
  return { p: compileProgram(serialize(doc), host), doc };
};

describe('CPU profile', () => {
  it('counts runs and cycles per event block, and statement starts while profiling', () => {
    const { p, doc } = compile(`
on(Spawned, () => {
  act(1);
  act(2);
});
on(Arrived, () => {
  if (1 == 2) {
    act(3);
  }
});
`);
    const fs = createFlow(p, 64, 8, 0);
    profileFlow(fs);
    const first = runFlow(fs, api, null, 1000, 0);
    raise(fs, EventId.Arrived);
    raise(fs, EventId.Arrived);
    const second = runFlow(fs, api, null, 1000, 1);
    const prof = cpuProfile(fs);
    expect(prof.handlers.map((h) => [h.label, h.runs, h.cycles])).toEqual([
      ['Spawned', 1, first],
      ['Arrived', 2, second],
    ]);
    // Statement starts, by id: both calls once; the branch twice, the call inside it never.
    const hits = new Map(p.stmtIds.map((id, i) => [id, fs.hits![i]]));
    const [a1, a2] = doc.handlers[0].body;
    const branch = doc.handlers[1].body[0];
    expect([hits.get(a1.id), hits.get(a2.id), hits.get(branch.id)]).toEqual([1, 1, 2]);
    expect(branch.k === 'if' && hits.get(branch.then[0].id)).toBe(0);
  });

  it('cycles paused mid-handler are counted where they ran, over several ticks', () => {
    const { p } = compile(`
on(Spawned, () => {
  act(1);
  act(2);
  act(3);
});
`);
    const fs = createFlow(p, 64, 8, 0);
    let total = 0;
    for (let t = 0; t < 10; t++) total += runFlow(fs, api, null, 4, t);
    expect(cpuProfile(fs).handlers[0]).toMatchObject({ runs: 1, cycles: total });
    expect(fs.hits).toBeNull(); // statement counts only while profiling
  });

  it('labels a block’s event blocks with the block’s name', () => {
    const { doc } = parseText(HARVESTER_CLASS.text!, FLOW_HOST);
    const p = compileProgram(serialize(doc), FLOW_HOST);
    const fs = createFlow(p, 64, 8, 0);
    const labels = cpuProfile(fs).handlers.map((h) => h.label);
    expect(labels).toEqual(expect.arrayContaining(['Order · TakeOrders', expect.stringMatching(/ · HarvestLoop$/)]));
  });

  it('a test run reports cycles by event block and a heat map keyed by graph node id', () => {
    const r = testRun(SCOUT_CLASS.parts, SCOUT_CLASS.program, { ticks: 200, order: 'attack' });
    expect(r.error).toBeUndefined();
    const prof = r.profile!;
    expect(prof.ticks).toBe(200);
    const ran = prof.handlers.filter((h) => h.runs > 0);
    expect(ran.length).toBeGreaterThan(0);
    expect(ran.every((h) => h.cycles > 0)).toBe(true);
    // The scout is blocks only: each block card's id carries the runs of all its event blocks.
    const { doc } = parseText(SCOUT_CLASS.text!, FLOW_HOST);
    const engage = doc.blocks!.find((b) => b.block === 'EngageEnemies')!;
    const ownRuns = prof.handlers.filter((h) => h.id.startsWith(`${engage.id}~`)).reduce((n, h) => n + h.runs, 0);
    expect(ownRuns).toBeGreaterThan(0);
    expect(prof.hits[engage.id]).toBe(ownRuns);
  });
});
