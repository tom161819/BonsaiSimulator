// Testy simulačního jádra (bez grafiky): node scripts/run.mjs scripts/test.ts
import assert from 'node:assert/strict';
import { Timeline } from '../src/sim/timeline';
import { YEAR, stats } from '../src/sim/util';
import type { State } from '../src/sim/types';

const sig = (s: State) => JSON.stringify(s.shoots.map((x) => [x.id, x.parent, +x.len.toFixed(4), x.buds.length, x.dead]));
const at = (y: number, doy: number) => y * YEAR + doy;
let n = 0;
const test = (name: string, f: () => void) => { f(); n++; console.log('ok  ' + name); };

test('semenáček vyklíčí a první rok měří pár centimetrů', () => {
  const tl = new Timeline(1);
  tl.seek(at(0, 300));
  const st = stats(tl.state);
  assert.ok(st.height > 3 && st.height < 9, `výška ${st.height}`);
  assert.ok(st.buds >= 1);
});

test('přehrání je deterministické a nezávisí na tom, jak se časem pohybujeme', () => {
  const a = new Timeline(5); a.seek(at(6, 200));
  const b = new Timeline(5); b.seek(at(3, 10)); b.seek(at(8, 0)); b.seek(at(6, 200));
  assert.equal(sig(a.state), sig(b.state));
});

test('zaštípnutí svíčky zkrátí výhon a příští rok dá víc slabších výhonů', () => {
  const mk = () => { const tl = new Timeline(3); tl.seek(at(4, 135)); return tl; };
  const ref = mk(), cut = mk();
  const leader = (tl: Timeline) => tl.state.shoots.filter((s) => s.order === 0 && s.isMain && s.bornYear === 4)[0];
  const id = leader(cut).id;
  assert.ok(leader(cut).elong, 'vrchol se v květnu prodlužuje');
  cut.act({ type: 'cut', shoot: id, t: 0.5 });
  ref.seek(at(4, 300)); cut.seek(at(4, 300));
  const a = leader(ref), b = cut.state.shoots.find((s) => s.id === id)!;
  assert.ok(Math.abs(b.len - a.len * 0.5) < 1e-6, 'poloviční délka');
  assert.ok(b.buds.length >= 2 && b.buds.every((x) => x.kind === 'pinch'), 'u řezu se založí více rovnocenných pupenů');
  assert.ok(Math.max(...b.buds.map((x) => x.len)) < Math.max(...a.buds.map((x) => x.len)), 'pupeny jsou slabší než terminál');
});

test('řez do dřeva bez jehlic větev zabije, řez s jehlicemi ne', () => {
  const tl = new Timeline(3); tl.seek(at(5, 20));
  const br = tl.state.shoots.find((s) => s.order === 1 && s.bornYear === 2 && !s.dead)!;
  const old = br.id;
  tl.seek(at(6, 20)); // jehlice z roku 2 už opadly
  const sh = tl.state.shoots.find((s) => s.id === old);
  if (sh && !sh.dead) {
    assert.equal(sh.needleLive, 0);
    tl.act({ type: 'cut', shoot: old, t: 0.5 });
    assert.ok(tl.state.shoots.find((s) => s.id === old)!.dead, 'holý pahýl odumřel');
  }
  const young = tl.state.shoots.find((s) => s.bornYear === 5 && s.order > 0 && !s.dead)!;
  tl.act({ type: 'cut', shoot: young.id, t: 0.6 });
  assert.ok(!tl.state.shoots.find((s) => s.id === young.id)!.dead);
});

test('vrácení zásahu obnoví původní strom', () => {
  const tl = new Timeline(9); tl.seek(at(3, 140));
  const before = sig(tl.state);
  const sh = tl.state.shoots.find((s) => s.elong)!;
  tl.act({ type: 'cut', shoot: sh.id, t: 0.3 });
  assert.notEqual(sig(tl.state), before);
  tl.undo();
  assert.equal(sig(tl.state), before);
});

test('zásah v minulosti přepíše pozdější zásahy', () => {
  const tl = new Timeline(9); tl.seek(at(3, 140));
  tl.act({ type: 'cut', shoot: tl.state.shoots.find((s) => s.elong)!.id, t: 0.5 });
  tl.seek(at(2, 140));
  assert.equal(tl.futureActions(), 1);
  tl.act({ type: 'repot', pot: 'ground' });
  assert.equal(tl.actions.length, 1);
});

test('miska brzdí růst proti volné půdě', () => {
  const h = (pot: 'ground' | 'bonsai') => { const tl = new Timeline(2); tl.act({ type: 'repot', pot }); tl.seek(at(9, 300)); return stats(tl.state).height; };
  assert.ok(h('ground') > 2 * h('bonsai'));
});

console.log(`\n${n} testů prošlo`);
