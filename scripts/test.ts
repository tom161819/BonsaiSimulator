// Testy simulačního jádra (bez grafiky): node scripts/run.mjs scripts/test.ts
import assert from 'node:assert/strict';
import { Timeline } from '../src/sim/timeline';
import { YEAR, bendLimit, cross, norm, rootFill, rotate, shootPoint, stats } from '../src/sim/util';
import type { State, Vec3 } from '../src/sim/types';
import samples from '../src/samples.json';

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
  const grow = (pot: 'ground' | 'bonsai') => { const tl = new Timeline(2); tl.act({ type: 'repot', pot }); tl.seek(at(9, 300)); return stats(tl.state); };
  const g = grow('ground'), b = grow('bonsai');
  assert.ok(g.height > b.height && g.needles > 2 * b.needles && g.baseDiameter > 1.5 * b.baseDiameter);
});

test('drát ohne větev i s podstromem; předčasné sundání ohyb vrátí, po sezónách tvar drží', () => {
  const mk = () => { const tl = new Timeline(3); tl.seek(at(5, 320)); return tl; };
  const tl = mk();
  const br = tl.state.shoots.find((s) => s.order === 1 && s.bornYear === 3 && !s.dead)!;
  const kid = tl.state.shoots.find((s) => s.parent === br.id)!;
  const d0 = [...br.dir], k0 = [...kid.dir];
  const ang = bendLimit(tl.state, br) * 0.9;
  tl.act({ type: 'wire', shoot: br.id, axis: [0, 0, 1], angle: ang });
  const get = (id: number) => tl.state.shoots.find((s) => s.id === id)!;
  const dotp = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(!get(br.id).dead && get(br.id).wire);
  assert.ok(dotp(get(kid.id).dir, k0) < 0.999, 'potomek se otočil s větví');
  tl.act({ type: 'unwire', shoot: br.id });
  assert.ok(dotp(get(br.id).dir, d0) > 0.9999, 'hned po sundání se větev vrátí');
  tl.undo();
  tl.seek(at(9, 320));
  assert.equal(get(br.id).wire!.set, 1);
  assert.ok(get(br.id).scar, 'drát ponechaný roky zaroste');
  const bent = [...get(br.id).dir];
  tl.act({ type: 'unwire', shoot: br.id });
  assert.ok(dotp(get(br.id).dir, bent) > 0.9999, 'po letech tvar drží');
});

test('ohyb daleko za bezpečnou mez větev zlomí', () => {
  const tl = new Timeline(3); tl.seek(at(5, 320));
  const br = tl.state.shoots.find((s) => s.order === 1 && s.bornYear === 3 && !s.dead)!;
  tl.act({ type: 'wire', shoot: br.id, axis: [0, 0, 1], angle: bendLimit(tl.state, br) * 1.5 });
  assert.ok(tl.state.shoots.find((s) => s.id === br.id)!.dead);
});

test('v misce kořeny přerostou a strom chřadne; pravidelné přesazování ho udrží', () => {
  const run = (repot: boolean) => {
    const tl = new Timeline(4);
    tl.seek(at(4, 75));
    tl.act({ type: 'repot', pot: 'bonsai', prune: 0.3 });
    for (let y = 5; y <= 14; y++) {
      tl.seek(at(y, 75));
      if (repot && (y - 4) % 3 === 0) tl.act({ type: 'repot', pot: 'bonsai', prune: 0.4 });
    }
    tl.seek(at(14, 200));
    return { fill: rootFill(tl.state), needles: stats(tl.state).needles, stage: tl.state.stage };
  };
  const a = run(false), b = run(true);
  assert.ok(a.fill > 1.5, `bez přesazení přerostlé kořeny (${a.fill.toFixed(2)})`);
  assert.equal(b.stage, 'growing');
  assert.ok(b.needles > 1.5 * a.needles, `přesazovaný strom je vitálnější (${b.needles} vs ${a.needles})`);
});

test('tvrdé zakrácení kořenů uprostřed růstu strom zabije, v předjaří ne', () => {
  const go = (doy: number) => { const tl = new Timeline(4); tl.seek(at(5, doy)); tl.act({ type: 'repot', pot: 'bonsai', prune: 0.5 }); return tl.state.stage; };
  assert.equal(go(75), 'growing');
  assert.equal(go(150), 'dead');
});

test('strom přesazený nakřivo zůstane dole šikmý, ale nový vrchol roste vzhůru', () => {
  const tl = new Timeline(4); tl.seek(at(4, 75));
  tl.act({ type: 'repot', pot: 'training', prune: 0.2, tiltZ: -40 });
  assert.ok(tl.state.shoots[0].dir[1] < 0.85, 'kmen je nakloněný');
  tl.seek(at(7, 300));
  const top = tl.state.shoots.filter((s) => s.order === 0 && s.bornYear === 7 && !s.dead).pop()!;
  assert.ok(top.dir[1] > 0.93, `vrchol míří vzhůru (${top.dir[1].toFixed(2)})`);
});

test('oblouk: špička se stočí o celý úhel, větev se nezkrátí a plynulý ohyb snese víc než zlom', () => {
  const tl = new Timeline(3); tl.seek(at(5, 320));
  const br = tl.state.shoots.find((s) => s.order === 1 && s.bornYear === 3 && !s.dead)!;
  const kid = tl.state.shoots.find((s) => s.parent === br.id && s.attachT > 0.98)!;
  const k0 = [...kid.dir];
  assert.ok(bendLimit(tl.state, br, 1) >= bendLimit(tl.state, br, 0));
  const ang = Math.min(1.0, bendLimit(tl.state, br, 1) * 0.9);
  const axis = norm(cross(br.dir as Vec3, [0, 1, 0]));
  tl.act({ type: 'wire', shoot: br.id, axis, angle: ang, z: 1 });
  const b2 = tl.state.shoots.find((s) => s.id === br.id)!, k2 = tl.state.shoots.find((s) => s.id === kid.id)!;
  assert.ok(b2.arc && !b2.dead);
  const want = rotate(k0 as Vec3, axis, ang);
  assert.ok(Math.hypot(want[0] - k2.dir[0], want[1] - k2.dir[1], want[2] - k2.dir[2]) < 1e-6, 'potomek na špičce se stočil o celý úhel');
  const chord = Math.hypot(...shootPoint(b2, 1));
  assert.ok(chord < b2.len && chord > b2.len * 0.8, 'tětiva oblouku je kratší než délka výhonu');
  tl.act({ type: 'unwire', shoot: br.id });
  assert.equal(tl.state.shoots.find((s) => s.id === br.id)!.arc, null, 'hned po sundání se oblouk narovná');
});

test('větve se vahou jehličí prověšují: starší boční větve míří níž než mladé', () => {
  const tl = new Timeline(3); tl.act({ type: 'repot', pot: 'ground' }); tl.seek(at(9, 320));
  const avg = (born: number) => { const b = tl.state.shoots.filter((s) => s.order === 1 && !s.isMain && s.bornYear === born && !s.dead); return b.reduce((t, s) => t + s.dir[1], 0) / b.length; };
  assert.ok(avg(4) < avg(9) - 0.02, `větve z roku 4 (${avg(4).toFixed(2)}) jsou níž než z roku 9 (${avg(9).toFixed(2)})`);
});

test('povrchové kořeny se při přesazení otočí se stromem a dají se rozprostřít', () => {
  const tl = new Timeline(3); tl.seek(at(4, 75));
  const before = tl.state.nebari.map((r) => r.az);
  assert.ok(before.length >= 5);
  tl.act({ type: 'repot', pot: 'training', potId: 't5', prune: 0.2, yaw: 90 });
  tl.state.nebari.forEach((r, i) => assert.ok(Math.abs(r.az - (before[i] - Math.PI / 2)) < 1e-9));
  tl.seek(at(6, 75));
  tl.act({ type: 'repot', pot: 'training', potId: 't5', prune: 0.2, spread: 1 });
  const az = tl.state.nebari.map((r) => r.az).sort((a, b) => a - b);
  const gaps = az.slice(1).map((a, i) => a - az[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 1e-6, 'kořeny jsou rovnoměrně kolem kmene');
});

test('dospělý strom nese šištice, mladý ne', () => {
  const tl = new Timeline(3); tl.act({ type: 'repot', pot: 'ground' }); tl.seek(at(5, 200));
  assert.ok(!tl.state.shoots.some((s) => s.male || s.cone));
  tl.seek(at(10, 200));
  assert.ok(tl.state.shoots.some((s) => s.male) && tl.state.shoots.some((s) => s.cone));
});

test('sundání všech drátů je jeden zásah a jde vrátit', () => {
  const tl = new Timeline(3); tl.seek(at(5, 320));
  const brs = tl.state.shoots.filter((s) => s.order === 1 && !s.dead && !s.elong).slice(0, 3);
  for (const b of brs) tl.act({ type: 'wire', shoot: b.id, axis: [0, 0, 1], angle: 0.2 });
  assert.equal(tl.state.shoots.filter((s) => s.wire).length, 3);
  tl.act({ type: 'unwireAll' });
  assert.equal(tl.state.shoots.filter((s) => s.wire).length, 0);
  tl.undo();
  assert.equal(tl.state.shoots.filter((s) => s.wire).length, 3);
});

test('po odstranění vrcholu převezme osu boční větev a napřímí se', () => {
  const tl = new Timeline(3); tl.seek(at(5, 75));
  const top = tl.state.shoots.filter((s) => s.order === 0 && s.isMain && !s.dead && s.bornYear === 4).pop()!;
  tl.act({ type: 'cut', shoot: top.id, t: 0 });
  const heir = tl.state.shoots.find((s) => s.parent === top.parent && s.isMain && !s.dead)!;
  assert.ok(heir && heir.order === 0, 'větev se stala pokračováním kmene');
  tl.seek(at(8, 300));
  const lead = tl.state.shoots.filter((s) => s.order === 0 && s.isMain && !s.dead && s.bornYear === 8).pop()!;
  assert.ok(lead.dir[1] > 0.9, `nový vrchol míří vzhůru (${lead.dir[1].toFixed(2)})`);
});

test('vzorová sbírka se přehraje do stejného stromu (po změně modelu růstu spusťte npm run samples)', () => {
  assert.ok(samples.length >= 4);
  for (const k of samples as unknown as { id: string; seed: number; rules: number; day: number; height: number; actions: never[] }[]) {
    const tl = new Timeline(k.seed, k.actions, k.rules); tl.seek(k.day);
    assert.equal(tl.state.stage, 'growing', k.id);
    assert.ok(Math.abs(stats(tl.state).height - k.height) < 0.2, `${k.id}: výška ${stats(tl.state).height.toFixed(1)} místo ${k.height}`);
  }
});

console.log(`\n${n} testů prošlo`);
