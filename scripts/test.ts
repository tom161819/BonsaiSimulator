// Testy simulačního jádra (bez grafiky): node scripts/run.mjs scripts/test.ts
import assert from 'node:assert/strict';
import { Timeline } from '../src/sim/timeline';
import { splitShoot, wholeBranch } from '../src/sim/actions';
import { YEAR, bendLimit, breakRisk, computeFrames, mossCover, potExhaust, potStatus, weedLoad, cross, norm, rootFill, rotate, shootPoint, stats } from '../src/sim/util';
import type { Action, State, Vec3 } from '../src/sim/types';
import samples from '../src/samples.json';
import { SPECIES_ORDER } from '../src/sim/species';
import { P, POTS, POT_FAMILIES, POT_VOLUMES, potById, potOf } from '../src/sim/params';
import { computeLeafLight } from '../src/sim/light';

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
  const mk = () => { const tl = new Timeline(3, [], 8); tl.seek(at(4, 135)); return tl; };
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
  const tl = new Timeline(3, [], 8); tl.seek(at(5, 20));
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
  const tl = new Timeline(9, [], 8); tl.seek(at(3, 140));
  const before = sig(tl.state);
  const sh = tl.state.shoots.find((s) => s.elong)!;
  tl.act({ type: 'cut', shoot: sh.id, t: 0.3 });
  assert.notEqual(sig(tl.state), before);
  tl.undo();
  assert.equal(sig(tl.state), before);
});

test('zásah v minulosti přepíše pozdější zásahy', () => {
  const tl = new Timeline(9, [], 8); tl.seek(at(3, 140));
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
  const mk = () => { const tl = new Timeline(3, [], 8); tl.seek(at(5, 320)); return tl; };
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
  const tl = new Timeline(3, [], 8); tl.seek(at(5, 320));
  const br = tl.state.shoots.find((s) => s.order === 1 && s.bornYear === 3 && !s.dead)!;
  tl.act({ type: 'wire', shoot: br.id, axis: [0, 0, 1], angle: bendLimit(tl.state, br) * 1.5 });
  assert.ok(tl.state.shoots.find((s) => s.id === br.id)!.dead);
});

test('v misce kořeny přerostou a strom chřadne; pravidelné přesazování ho udrží', () => {
  const run = (repot: boolean) => {
    const tl = new Timeline(4, [], 8);
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
  const go = (doy: number) => { const tl = new Timeline(4, [], 8); tl.seek(at(5, doy)); tl.act({ type: 'repot', pot: 'bonsai', prune: 0.5 }); return tl.state.stage; };
  assert.equal(go(75), 'growing');
  assert.equal(go(150), 'dead');
});

test('strom přesazený nakřivo zůstane dole šikmý, ale nový vrchol roste vzhůru', () => {
  const tl = new Timeline(4, [], 8); tl.seek(at(4, 75));
  tl.act({ type: 'repot', pot: 'training', prune: 0.2, tiltZ: -40 });
  assert.ok(tl.state.shoots[0].dir[1] < 0.85, 'kmen je nakloněný');
  tl.seek(at(7, 300));
  const top = tl.state.shoots.filter((s) => s.order === 0 && s.bornYear === 7 && !s.dead).pop()!;
  assert.ok(top.dir[1] > 0.93, `vrchol míří vzhůru (${top.dir[1].toFixed(2)})`);
});

test('oblouk: špička se stočí o celý úhel, větev se nezkrátí a plynulý ohyb snese víc než zlom', () => {
  const tl = new Timeline(3, [], 8); tl.seek(at(5, 320));
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
  const tl = new Timeline(3, [], 8); tl.act({ type: 'repot', pot: 'ground' }); tl.seek(at(9, 320));
  const avg = (born: number) => { const b = tl.state.shoots.filter((s) => s.order === 1 && !s.isMain && s.bornYear === born && !s.dead); return b.reduce((t, s) => t + s.dir[1], 0) / b.length; };
  assert.ok(avg(4) < avg(9) - 0.02, `větve z roku 4 (${avg(4).toFixed(2)}) jsou níž než z roku 9 (${avg(9).toFixed(2)})`);
});

test('povrchové kořeny se při přesazení otočí se stromem a dají se rozprostřít', () => {
  const tl = new Timeline(3, [], 8); tl.seek(at(4, 75));
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
  const tl = new Timeline(3, [], 8); tl.act({ type: 'repot', pot: 'ground' }); tl.seek(at(5, 200));
  assert.ok(!tl.state.shoots.some((s) => s.male || s.cone));
  tl.seek(at(10, 200));
  assert.ok(tl.state.shoots.some((s) => s.male) && tl.state.shoots.some((s) => s.cone));
});

test('sundání všech drátů je jeden zásah a jde vrátit', () => {
  const tl = new Timeline(3, [], 8); tl.seek(at(5, 320));
  const brs = tl.state.shoots.filter((s) => s.order === 1 && !s.dead && !s.elong).slice(0, 3);
  for (const b of brs) tl.act({ type: 'wire', shoot: b.id, axis: [0, 0, 1], angle: 0.2 });
  assert.equal(tl.state.shoots.filter((s) => s.wire).length, 3);
  tl.act({ type: 'unwireAll' });
  assert.equal(tl.state.shoots.filter((s) => s.wire).length, 0);
  tl.undo();
  assert.equal(tl.state.shoots.filter((s) => s.wire).length, 3);
});

test('po odstranění vrcholu převezme osu boční větev a napřímí se', () => {
  const tl = new Timeline(3, [], 8); tl.seek(at(5, 75));
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

test('v3: větev, která převzala vrchol, se zvedá i ve starém dřevě; ve v2 zůstává ležet', () => {
  const run = (rules: number) => {
    const tl = new Timeline(3, [], rules); tl.seek(at(6, 75));
    const top = tl.state.shoots.filter((s) => s.order === 0 && s.isMain && !s.dead && s.bornYear === 4).pop()!;
    tl.act({ type: 'cut', shoot: top.id, t: 0 });
    const heir = tl.state.shoots.find((s) => s.parent === top.parent && s.isMain && !s.dead)!;
    const before = heir.dir[1];
    tl.seek(at(12, 320));
    return { before, after: tl.state.shoots.find((s) => s.id === heir.id)!.dir[1] };
  };
  const v3 = run(3), v2 = run(2);
  assert.ok(v3.after > v3.before + 0.15 && v3.after > 0.8, `v3: ${v3.before.toFixed(2)} -> ${v3.after.toFixed(2)}`);
  assert.ok(Math.abs(v2.after - v2.before) < 0.02, `v2 beze změny: ${v2.before.toFixed(2)} -> ${v2.after.toFixed(2)}`);
});

// ---------------------------------------------------------------- další druhy
const leavesOf = (tl: Timeline) => tl.state.shoots.reduce((t, s) => t + (s.dead ? 0 : Math.round(s.needleCount * s.needleLive)), 0);

test('všechny druhy vyklíčí, rostou a přežijí deset let bez zásahu', () => {
  for (const id of SPECIES_ORDER) {
    const tl = new Timeline(4, [], 8, id); tl.act({ type: 'repot', pot: 'ground' }); tl.seek(at(9, 200));
    const st = stats(tl.state);
    assert.equal(tl.state.stage, 'growing', id);
    assert.ok(st.height > 60 && st.height < 800, `${id}: výška ${st.height.toFixed(0)} cm`);
    assert.ok(st.baseDiameter > 1 && st.baseDiameter < 16, `${id}: kmen ${st.baseDiameter.toFixed(1)} cm`);
  }
});

test('listnáče na zimu opadají a na jaře znovu olistí; buk drží suché listí, bříza ne', () => {
  for (const [id, keeps] of [['beech', true], ['hornbeam', true], ['birch', false], ['maple', false], ['larch', false]] as [string, boolean][]) {
    const tl = new Timeline(4, [], 8, id); tl.seek(at(5, 200));
    const summer = leavesOf(tl);
    tl.seek(at(5, 350));
    const winter = leavesOf(tl);
    tl.seek(at(6, 200));
    assert.ok(summer > 20, `${id}: v létě olistěný (${summer})`);
    assert.ok(keeps ? winter > summer * 0.3 : winter === 0, `${id}: v zimě ${winter} z ${summer} listů`);
    assert.ok(leavesOf(tl) > summer, `${id}: další rok víc listů`);
  }
});

test('habr po řezu do holého dřeva obrazí, borovice ne', () => {
  const cutOld = (id: string) => {
    const tl = new Timeline(4, [], 8, id); tl.seek(at(6, 60));
    // nejstarší boční větev zkrátit na pahýl bez listí a bez větvení
    const br = tl.state.shoots.find((s) => s.order === 1 && !s.dead && s.bornYear <= 3 && s.kind === 'shoot')!;
    tl.act({ type: 'cut', shoot: br.id, t: 0.3 });
    tl.seek(at(8, 200));
    const now = tl.state.shoots.find((s) => s.id === br.id);
    return !!now && !now.dead && tl.state.shoots.some((s) => s.parent === br.id && !s.dead);
  };
  assert.ok(cutOld('hornbeam'), 'habr z pahýlu vyrašil');
  assert.ok(!cutOld('pine'), 'borovice z pahýlu nevyrašila');
});

test('habr po zaštípnutí vyraší ještě téhož léta, buk a borovice jen výjimečně nebo vůbec', () => {
  const again = (id: string) => {
    const tl = new Timeline(6, [], 8, id); tl.seek(at(4, 150));
    const before = tl.state.shoots.length;
    for (const sh of tl.state.shoots.filter((s) => s.elong && s.kind === 'shoot' && s.targetLen > 4)) tl.act({ type: 'cut', shoot: sh.id, t: 0.5 });
    tl.seek(at(4, 195));
    return tl.state.shoots.length - before;
  };
  assert.ok(again('hornbeam') > 0, 'habr vyrašil podruhé');
  assert.equal(again('pine'), 0);
});

test('v4: pahýl habru obrazí několika výhony po délce, ne jedním u řezu', () => {
  const tl = new Timeline(4, [], 4, 'hornbeam'); tl.seek(at(6, 60));
  const trunk = tl.state.shoots.filter((s) => s.order === 0 && s.isMain && !s.dead && s.kind === 'shoot');
  const seg = trunk[1];
  tl.act({ type: 'cut', shoot: seg.id, t: 0.6 });
  for (const k of tl.state.shoots.filter((s) => s.parent === seg.id)) tl.act({ type: 'cut', shoot: k.id, t: 0 });
  tl.seek(at(7, 200));
  const kids = tl.state.shoots.filter((s) => s.parent === seg.id && !s.dead);
  assert.ok(kids.length >= 3, `výhonů z pahýlu: ${kids.length}`);
  assert.ok(kids.every((k) => k.attachT < 0.98) && Math.max(...kids.map((k) => k.attachT)) - Math.min(...kids.map((k) => k.attachT)) > 0.2, 'rozmístěné po délce, ne na řezné ploše');
});

test('v5: modřín ve velké nádobě je v pěti letech vyšší než metr; ve v4 zůstává malý', () => {
  const h = (rules: number) => { const tl = new Timeline(7, [], rules, 'larch'); tl.seek(at(1, 75)); tl.act({ type: 'repot', pot: 'training', potId: 't25', prune: 0 }); tl.seek(at(4, 220)); return stats(tl.state).height; };
  assert.ok(h(5) > 100 && h(5) < 250, `v5: ${h(5).toFixed(0)} cm`);
  assert.ok(h(4) < 60, `v4: ${h(4).toFixed(0)} cm`);
});

test('sundání zarůstajících drátů nechá ostatní dráty na místě', () => {
  const tl = new Timeline(3, [], 3); tl.seek(at(5, 320));
  const old = tl.state.shoots.find((s) => s.order === 1 && !s.dead && !s.elong)!;
  tl.act({ type: 'wire', shoot: old.id, axis: [0, 0, 1], angle: 0.2 });
  tl.seek(at(8, 320));
  const fresh = tl.state.shoots.find((s) => s.order === 1 && !s.dead && !s.elong && !s.wire && s.bornYear === 7)!;
  tl.act({ type: 'wire', shoot: fresh.id, axis: [0, 0, 1], angle: 0.2 });
  assert.ok(tl.state.shoots.find((s) => s.id === old.id)!.scar, 'starý drát zarůstá');
  tl.act({ type: 'unwireAll', only: 'biting' });
  assert.equal(tl.state.shoots.find((s) => s.id === old.id)!.wire, null);
  assert.ok(tl.state.shoots.find((s) => s.id === fresh.id)!.wire, 'nový drát zůstal');
});

test('odstranění suchých větví nechá živé výhony beze změny', () => {
  const tl = new Timeline(3, [], 3); tl.seek(at(12, 200));
  // řez do holého dřeva: pahýl bez jehlic u borovice odumře
  for (const b of tl.state.shoots.filter((s) => s.order === 1 && !s.dead && s.needleLive === 0).slice(0, 3)) tl.act({ type: 'cut', shoot: b.id, t: 0.5 });
  tl.seek(at(13, 200));
  const dead = tl.state.shoots.filter((s) => s.dead && s.parent >= 0).length;
  const live = tl.state.shoots.filter((s) => !s.dead).map((s) => s.id).join();
  assert.ok(dead > 0, 'strom má suché větve');
  tl.act({ type: 'cleanDead' });
  assert.equal(tl.state.shoots.filter((s) => s.dead && s.parent >= 0).length, 0);
  assert.equal(tl.state.shoots.filter((s) => !s.dead).map((s) => s.id).join(), live);
  const ids = new Set(tl.state.shoots.map((s) => s.id));
  assert.ok(tl.state.shoots.every((s) => s.parent < 0 || ids.has(s.parent)), 'nic nevisí bez rodiče');
});

test('v6: silná větev snese větší ohyb a riziko roste pomaleji; v5 beze změny', () => {
  const lim = (rules: number) => {
    const tl = new Timeline(3, [], rules); tl.seek(at(12, 320));
    const sh = tl.state.shoots.filter((s) => !s.dead && s.parent >= 0).sort((a, b) => b.area - a.area)[0];
    const safe = bendLimit(tl.state, sh);
    return { safe: (safe * 180) / Math.PI, risk: breakRisk(tl.state, sh, safe * 1.5) };
  };
  const a = lim(5), b = lim(6);
  assert.ok(b.safe > a.safe * 1.3, `v5 ${a.safe.toFixed(0)}°, v6 ${b.safe.toFixed(0)}°`);
  assert.ok(Math.abs(a.risk - 1) < 1e-9);
  assert.ok(Math.abs(b.risk - 0.5) < 1e-9);
});

test('v7: zkrácený kmen habru vyžene nový vrchol a spodní třetina tolik neobrůstá', () => {
  const run = (rules: number) => {
    const acts: Action[] = [{ day: 440, type: 'repot', pot: 'training', potId: 't2', prune: 0 }];
    let tl = new Timeline(4, acts, rules, 'hornbeam'); tl.seek(4 * 365 + 20);
    let fr = computeFrames(tl.state);
    const trunk = tl.state.shoots.find((s, i) => s.order === 0 && !s.dead && fr.base[i * 3 + 1] <= 55 && fr.tip[i * 3 + 1] > 55)!;
    const i0 = fr.index.get(trunk.id)!;
    acts.push({ day: 4 * 365 + 20, type: 'cut', shoot: trunk.id, t: (55 - fr.base[i0 * 3 + 1]) / (fr.tip[i0 * 3 + 1] - fr.base[i0 * 3 + 1]) });
    tl = new Timeline(4, acts, rules, 'hornbeam'); tl.seek(7 * 365 + 300);
    const s = tl.state; fr = computeFrames(s);
    const by = Math.max(...s.shoots.map((q) => q.bornYear));
    let H = 0; s.shoots.forEach((q, i) => { if (!q.dead) H = Math.max(H, fr.tip[i * 3 + 1]); });
    let low = 0, lead = 0;
    s.shoots.forEach((q, i) => { if (q.dead || q.bornYear !== by) return; if (fr.base[i * 3 + 1] < H / 3) low++; if (q.order === 0) lead = Math.max(lead, q.len); });
    return { low, lead };
  };
  const a = run(6), b = run(7);
  assert.ok(b.lead > 4, `nový vrchol ve v7: ${b.lead.toFixed(1)} cm`);
  assert.ok(b.low < a.low * 0.9, `nových výhonů dole: v6 ${a.low}, v7 ${b.low}`);
});

test('celá větev k rozvětvení: z konce osy dojde k výhonu, který sedí na kmeni nebo ve vidlici', () => {
  const tl = new Timeline(3, [], 3); tl.seek(at(9, 320));
  const s = tl.state;
  const by = new Map(s.shoots.map((x) => [x.id, x]));
  let checked = 0;
  for (const sh of s.shoots) {
    if (sh.dead || sh.parent < 0 || s.shoots.some((x) => x.parent === sh.id)) continue; // jen koncové výhony
    const w = wholeBranch(s, sh.id)!;
    const par = by.get(w.parent)!;
    const fork = w.attachT <= 0.98 || par.parent < 0 || par.buds.length > 0 || s.shoots.some((x) => x.parent === par.id && x.id !== w.id && !x.dead) || (par.order === 0 && par.isMain && !(w.order === 0 && w.isMain));
    assert.ok(fork, `výhon ${w.id} nekončí v rozvětvení`);
    checked++;
  }
  assert.ok(checked > 10);
});

test('řez podle linie: více řezů v jednom zásahu jde vrátit najednou', () => {
  const tl = new Timeline(3, [], 3); tl.seek(at(8, 320));
  const tips = tl.state.shoots.filter((s) => !s.dead && s.order === 1 && !tl.state.shoots.some((x) => x.parent === s.id)).slice(0, 4);
  const before = tl.state.shoots.map((s) => s.len).join();
  tl.act({ type: 'cutMany', cuts: tips.map((s) => ({ shoot: s.id, t: 0.5 })) });
  for (const t of tips) assert.ok(tl.state.shoots.find((s) => s.id === t.id)!.tipCut);
  tl.undo();
  assert.equal(tl.state.shoots.map((s) => s.len).join(), before);
});

test('v8: druhé drátování počítá jen ohyb navíc a po sundání drátu zůstane zarostlý tvar', () => {
  const run = (rules: number) => {
    const tl = new Timeline(3, [], rules); tl.seek(at(6, 320));
    const id = tl.state.shoots.filter((s) => s.order === 1 && !s.dead && !s.elong).sort((a, b) => b.area - a.area)[0].id;
    const get = () => tl.state.shoots.find((s) => s.id === id)!;
    const axis: Vec3 = norm(cross(get().dir, [0, 1, 0]));
    const first = bendLimit(tl.state, get(), 0.7) * 0.9;
    tl.act({ type: 'wire', shoot: id, axis, angle: first, z: 0.7 });
    tl.seek(at(12, 320));
    assert.ok(get().wire!.set > 0.99, `tvar drží z ${get().wire!.set}`);
    tl.act({ type: 'unwire', shoot: id });
    const kept = get().arc!.angle;
    assert.ok(Math.abs(kept - first) < 1e-6, 'zarostlý ohyb po sundání drátu zůstal');
    const ax2 = get().arc!.axis;
    const more = bendLimit(tl.state, get(), 0.7) * 0.5;
    const risk = breakRisk(tl.state, get(), kept + more, 0.7, ax2);
    tl.act({ type: 'wire', shoot: id, axis: ax2, angle: kept + more, z: 0.7 });
    const broke = get().dead;
    if (!broke) tl.act({ type: 'unwire', shoot: id }); // hned zase dolů: nic nového nezdřevnatělo
    return { kept, risk, broke, after: get().arc?.angle ?? 0 };
  };
  const b = run(8);
  assert.equal(b.risk, 0, 'ohyb o půl meze navíc je bezpečný');
  assert.ok(!b.broke && Math.abs(b.after - b.kept) < 1e-6, `po sundání nového drátu zůstal starý tvar (${b.after} vs ${b.kept})`);
  const a = run(7);
  assert.ok(a.broke || a.after < a.kept * 0.5, 'v7 se chová postaru');
});

test('mech: po přesazení žádný, za rok třetina, za dva roky celá miska; jde vrátit, položit i odstranit', () => {
  const tl = new Timeline(3, [], 3); tl.seek(at(4, 80));
  tl.act({ type: 'repot', pot: 'bonsai', potId: 'b15', prune: 0.2 });
  assert.equal(mossCover(tl.state), 0);
  tl.seek(tl.day + 180); const half = mossCover(tl.state);
  tl.seek(tl.day + 185); const one = mossCover(tl.state);
  tl.seek(tl.day + 365); const two = mossCover(tl.state);
  assert.ok(half > 0.05 && half < 0.2 && one > 0.25 && one < 0.45 && two === 1, `${half} ${one} ${two}`);
  tl.act({ type: 'moss' });
  assert.equal(mossCover(tl.state), 0);
  tl.seek(tl.day + 365); const before = mossCover(tl.state);
  tl.act({ type: 'repot', pot: 'bonsai', potId: 'b15', prune: 0.1, moss: 'keep' });
  assert.equal(mossCover(tl.state), before);
  tl.act({ type: 'repot', pot: 'bonsai', potId: 'b15', prune: 0, moss: 'full' });
  assert.equal(mossCover(tl.state), 1);
});

// ---- pravidla v9: nádoba růst omezuje
const potRun = (rules: number, species: string, potId: string, years: number, extra: Action[] = []) => {
  const type = potId[0] === 't' ? 'training' : 'bonsai';
  const tl = new Timeline(4, [{ day: 300, type: 'repot', pot: type, potId, prune: 0 }, ...extra], rules, species);
  tl.seek(at(years, 250));
  return tl;
};

test('v9: strom v 5l nádobě se zastaví; ve v8 roste dál bez omezení', () => {
  const a = stats(potRun(8, 'maple', 't5', 10).state), b = stats(potRun(9, 'maple', 't5', 10).state);
  assert.ok(a.height > 350 && a.baseDiameter > 3.5, `v8: ${a.height.toFixed(0)} cm, ${(a.baseDiameter * 10).toFixed(0)} mm`);
  assert.ok(b.height < 220 && b.baseDiameter < 1.5, `v9: ${b.height.toFixed(0)} cm, ${(b.baseDiameter * 10).toFixed(0)} mm`);
});

test('v9: větší nádoba znamená větší strom', () => {
  const d = (potId: string) => stats(potRun(9, 'maple', potId, 8).state).baseDiameter;
  const a = d('t05'), b = d('t5'), c = d('t25');
  assert.ok(a < b * 0.6 && b < c * 0.7, `0,5 l ${(a * 10).toFixed(1)} mm, 5 l ${(b * 10).toFixed(1)} mm, 25 l ${(c * 10).toFixed(1)} mm`);
});

test('v9: přerostlý strom nejdřív stagnuje, pak chřadne a nakonec uhyne', () => {
  const tl = potRun(9, 'maple', 't05', 4);
  assert.equal(potStatus(tl.state), 2, 'po pár letech je nádoba přerostlá');
  assert.equal(potExhaust(tl.state), 1, 'první roky strom jen stagnuje');
  tl.seek(at(8, 250));
  assert.equal(potStatus(tl.state), 3);
  const live9 = tl.state.shoots.filter((s) => !s.dead).length;
  tl.seek(at(11, 250));
  assert.ok(tl.state.shoots.filter((s) => !s.dead).length < live9, 'větve odumírají');
  assert.equal(tl.state.stage, 'growing');
  tl.seek(at(16, 250));
  assert.equal(tl.state.stage, 'dead');
});

test('v9: přesazení se zkrácením kořenů chřadnutí zastaví; bez zkrácení ne', () => {
  const tl = potRun(9, 'maple', 't05', 9);
  assert.ok((tl.state.bound ?? 0) > P.boundGrace9);
  tl.seek(at(10, 75));
  tl.act({ type: 'repot', pot: 'training', potId: 't05', prune: 0 });
  assert.ok((tl.state.bound ?? 0) >= P.boundGrace9, 'stejná nádoba bez zkrácení kořenů nepomůže');
  tl.undo();
  tl.act({ type: 'repot', pot: 'training', potId: 't5', prune: 0.3 });
  assert.equal(tl.state.bound, 0);
  assert.equal(potStatus(tl.state), 0);
  const d0 = stats(tl.state).baseDiameter;
  tl.seek(at(13, 250));
  assert.equal(tl.state.stage, 'growing');
  assert.ok(stats(tl.state).baseDiameter > d0 * 1.3, 'po přesazení strom zase sílí');
});

// ---- pravidla v10: velikost listů, stín v koruně, nástroj Listy
const pinched = (rules: number) => {
  // javor v 5 l, v 5. roce zkrácený kmen, pak dvakrát ročně zkrácení všech výhonů delších než 5 cm
  const tl = new Timeline(4, [{ day: 300, type: 'repot', pot: 'training', potId: 't5', prune: 0 }], rules, 'maple');
  const prune = () => {
    const yr = Math.floor(tl.state.day / YEAR);
    const cuts = tl.state.shoots.filter((q) => !q.dead && q.parent >= 0 && q.bornYear >= yr - 1 && q.len > 5 && !q.tipCut).map((q) => ({ shoot: q.id, t: Math.max(0.15, Math.min(0.9, 4 / q.len)) }));
    if (cuts.length) tl.act({ type: 'cutMany', cuts });
  };
  for (let y = 4; y < 8; y++) {
    tl.seek(at(y, 60));
    if (y === 4) {
      const fr = computeFrames(tl.state);
      const i = tl.state.shoots.findIndex((q, k) => q.order === 0 && !q.dead && fr.base[k * 3 + 1] <= 20 && fr.tip[k * 3 + 1] > 20);
      tl.act({ type: 'cut', shoot: tl.state.shoots[i].id, t: (20 - fr.base[i * 3 + 1]) / (fr.tip[i * 3 + 1] - fr.base[i * 3 + 1]) });
    } else prune();
    tl.seek(at(y, 170)); prune();
  }
  tl.seek(at(7, 205));
  return tl;
};
const leafStats = (s: State) => {
  let n = 0, len = 0;
  for (const q of s.shoots) if (!q.dead && q.needleLive > 0.02 && q.needleCount > 0) { n += q.needleCount; len += q.needleCount * q.needleLen; }
  return { n, mean: len / Math.max(1, n) };
};

test('v10: na pravidelně zastřihávaném javoru jsou listy výrazně menší než ve v9', () => {
  const a = leafStats(pinched(9).state), b = leafStats(pinched(10).state);
  assert.ok(a.mean > 3.2, `v9: ${a.mean.toFixed(2)} cm`);
  assert.ok(b.mean < a.mean * 0.85 && b.mean > 1.8, `v10: ${b.mean.toFixed(2)} cm (v9 ${a.mean.toFixed(2)} cm)`);
});

test('v10: list hluboko pod hustým olistěním dostane málo světla, list nahoře plné', () => {
  const tl = new Timeline(4, [{ day: 300, type: 'repot', pot: 'ground', potId: 'ground', prune: 0 }], 10, 'maple');
  tl.seek(at(7, 200));
  const s = tl.state, fr = computeFrames(s);
  computeLeafLight(s, fr);
  const leafy = s.shoots.map((q, i) => ({ q, y: fr.tip[i * 3 + 1] })).filter((x) => !x.q.dead && x.q.needleCount > 0);
  const H = Math.max(...leafy.map((x) => x.y));
  const mean = (xs: number[]) => xs.reduce((u, v) => u + v, 0) / Math.max(1, xs.length);
  const top = mean(leafy.filter((x) => x.y > H * 0.9).map((x) => x.q.leafLight ?? 1));
  const low = mean(leafy.filter((x) => x.y < H * 0.35).map((x) => x.q.leafLight ?? 1));
  assert.ok(top > 0.45, `nahoře ${top.toFixed(2)}`);
  assert.ok(low < top * 0.6, `dole ${low.toFixed(2)}, nahoře ${top.toFixed(2)}`);
  // osamocený krátký výhon bez čehokoli nad sebou má plné světlo
  const lone = new Timeline(4, [], 10, 'maple'); lone.seek(at(1, 200));
  computeLeafLight(lone.state, computeFrames(lone.state));
  assert.ok(Math.max(...lone.state.shoots.map((q) => q.leafLight ?? 0)) > 0.9);
  assert.ok(s.shoots.every((q) => q.dead || (q.leafLight ?? 0) >= 0 && (q.leafLight ?? 0) <= 1.0001));
});

test('v10: odstranění listů – v červnu vyraší znovu menší, jde vrátit a strom nezabije', () => {
  const tl = new Timeline(4, [{ day: 300, type: 'repot', pot: 'training', potId: 't10', prune: 0 }], 10, 'maple');
  tl.seek(at(4, 160));
  const before = leafStats(tl.state);
  const ids = tl.state.shoots.filter((q) => !q.dead && q.needleCount > 0).map((q) => q.id);
  tl.act({ type: 'leaf', shoots: ids, keep: 0.5 });
  const half = leafStats(tl.state);
  assert.ok(half.n < before.n * 0.65 && half.n > before.n * 0.4, `ob list: ${before.n} → ${half.n}`);
  tl.undo();
  assert.equal(leafStats(tl.state).n, before.n);
  tl.act({ type: 'leaf', shoots: ids, keep: 0 });
  assert.equal(leafStats(tl.state).n, 0);
  assert.ok(tl.state.stress > 0 && tl.state.stress < 0.5, `stres ${tl.state.stress}`);
  tl.seek(at(4, 215));
  const again = leafStats(tl.state);
  assert.equal(tl.state.stage, 'growing');
  assert.ok(again.n > 0, 'druhé rašení');
  assert.ok(again.mean < before.mean * 0.8, `nové listy jsou menší: ${again.mean.toFixed(1)} cm proti ${before.mean.toFixed(1)} cm`);
  tl.seek(at(5, 200));
  assert.equal(tl.state.stage, 'growing');
  assert.ok(leafStats(tl.state).n > before.n * 0.5, 'příští rok strom znovu olistí');
});

// ---- drátování v libovolném místě větve
test('rozdělení výhonu nezmění tvar stromu, olistění ani pupeny', () => {
  for (const [sp, yr] of [['pine', 6], ['maple', 4]] as [string, number][]) {
    const tl = new Timeline(4, [{ day: 300, type: 'repot', pot: 'training', potId: 't10', prune: 0 }], 10, sp); tl.seek(at(yr, 200));
    const s = tl.state;
    const before = computeFrames(s);
    const tipOf = new Map(s.shoots.map((q, i) => [q.id, [before.tip[i * 3], before.tip[i * 3 + 1], before.tip[i * 3 + 2]]]));
    const fol0 = s.shoots.reduce((u, q) => u + q.needleCount, 0), buds0 = s.shoots.reduce((u, q) => u + q.buds.length, 0), n0 = s.shoots.length;
    const cand = s.shoots.filter((q) => !q.dead && !q.elong && q.kind === 'shoot' && q.len > 4 && s.shoots.some((c) => c.parent === q.id)).slice(0, 6);
    assert.ok(cand.length >= 3, sp);
    const outs = cand.map((q) => [q.id, splitShoot(s, q.id, 0.45)!.id]);
    assert.equal(s.shoots.length, n0 + cand.length);
    assert.equal(s.shoots.reduce((u, q) => u + q.needleCount, 0), fol0);
    assert.equal(s.shoots.reduce((u, q) => u + q.buds.length, 0), buds0);
    const fr = computeFrames(s);
    s.shoots.forEach((q, i) => {
      const src = outs.find((o) => o[0] === q.id); // vnitřní část rozděleného výhonu končí dřív – její špičku teď nese vnější část
      const want = tipOf.get(src ? -1 : outs.find((o) => o[1] === q.id)?.[0] ?? q.id);
      if (!want) return;
      const e = Math.hypot(fr.tip[i * 3] - want[0], fr.tip[i * 3 + 1] - want[1], fr.tip[i * 3 + 2] - want[2]);
      assert.ok(e < 1e-3, `${sp}: špička výhonu ${q.id} se posunula o ${e}`);
    });
    // rodič je v poli vždy před potomkem
    const pos = new Map(s.shoots.map((q, i) => [q.id, i]));
    assert.ok(s.shoots.every((q, i) => q.parent < 0 || pos.get(q.parent)! < i));
    tl.seek(at(yr + 2, 200));
    assert.equal(tl.state.stage, 'growing');
  }
});

test('ohyb v místě větve: část před ním zůstane, držené místo míří tam, kam má; jde vrátit', () => {
  const tl = new Timeline(4, [{ day: 300, type: 'repot', pot: 'training', potId: 't10', prune: 0 }], 10, 'pine'); tl.seek(at(6, 320));
  const s = tl.state;
  const sh = s.shoots.filter((q) => !q.dead && !q.elong && q.kind === 'shoot' && q.order === 0 && q.len > 6)[1];
  const fr0 = computeFrames(s), i0 = fr0.index.get(sh.id)!;
  const B = [fr0.base[i0 * 3], fr0.base[i0 * 3 + 1], fr0.base[i0 * 3 + 2]];
  const mid = [0, 1, 2].map((k) => B[k] + sh.dir[k] * sh.len * 0.4);
  const n0 = s.shoots.length, len0 = sh.len;
  // oblouk přes 30 % délky za místem 0,4; tětiva má mířit o 10° stranou
  const want = norm(rotate(sh.dir, norm(cross(sh.dir, [1, 0, 0.3])), 10 / 57.2958));
  const axis = norm(cross(sh.dir, want));
  tl.act({ type: 'wire', shoot: sh.id, at: 0.4, axis, angle: 20 / 57.2958, z: 0.5 });
  const t = tl.state, fr = computeFrames(t);
  assert.equal(t.shoots.length, n0 + 1);
  const a = t.shoots.find((q) => q.id === sh.id)!, b = t.shoots.find((q) => q.parent === sh.id && q.split)!;
  assert.ok(Math.abs(a.len - len0 * 0.4) < 1e-9 && !a.wire && b.wire && b.arc);
  const ia = fr.index.get(a.id)!, ib = fr.index.get(b.id)!;
  assert.ok(Math.hypot(fr.tip[ia * 3] - mid[0], fr.tip[ia * 3 + 1] - mid[1], fr.tip[ia * 3 + 2] - mid[2]) < 1e-3, 'část před ohybem se nepohnula');
  const gp = shootPoint(b, 0.5), gl = Math.hypot(gp[0], gp[1], gp[2]);
  const dot = (gp[0] * want[0] + gp[1] * want[1] + gp[2] * want[2]) / gl;
  assert.ok(dot > 0.999999, `konec oblouku míří jinam (cos ${dot})`);
  void ib;
  tl.undo();
  assert.equal(tl.state.shoots.length, n0);
  assert.equal(tl.state.shoots.find((q) => q.id === sh.id)!.len, len0);
});

// ---- pravidla v11: pozdní výhony a odložené usychání
const lateSummer = (rules: number) => {
  // javor zaštipovaný koncem června a koncem července: druhé rašení vyroste až po letním zakládání pupenů
  const tl = new Timeline(4, [{ day: 300, type: 'repot', pot: 'training', potId: 't10', prune: 0 }], rules, 'maple');
  for (let y = 3; y < 6; y++) for (const d of [175, 205]) {
    tl.seek(at(y, d));
    const cuts = tl.state.shoots.filter((q) => !q.dead && q.parent >= 0 && q.bornYear === y && q.len > 5 && !q.tipCut).map((q) => ({ shoot: q.id, t: Math.max(0.15, Math.min(0.9, 4 / q.len)) }));
    if (cuts.length) tl.act({ type: 'cutMany', cuts });
  }
  return tl;
};
/** Kolik cizích výhonů uschne, když zkrátím jeden koncový výhon (bez potomků). */
const sideDeaths = (tl: Timeline) => {
  const s = tl.state;
  const tip = s.shoots.filter((q) => !q.dead && q.parent >= 0 && q.len > 2 && !q.elong && !s.shoots.some((c) => c.parent === q.id)).pop()!;
  const before = new Set(s.shoots.filter((q) => q.dead).map((q) => q.id));
  tl.act({ type: 'cut', shoot: tip.id, t: 0.75 });
  const died = tl.state.shoots.filter((q) => q.dead && !before.has(q.id) && q.id !== tip.id).length;
  tl.undo();
  return died;
};

test('v11: řez jednoho výhonu nenechá uschnout jiné (ve v10 jich v zimě uschly desítky)', () => {
  const a = lateSummer(10); a.seek(at(6, 20));
  assert.ok(sideDeaths(a) > 10, 've v10 se chyba projevuje');
  const b = lateSummer(11);
  for (const d of [at(5, 250), at(5, 315), at(6, 20), at(6, 130), at(6, 200)]) { b.seek(d); assert.equal(sideDeaths(b), 0, `den ${d}`); }
});

test('v11: výhonky z druhého rašení si založí pupeny a na jaře znovu raší', () => {
  const tl = lateSummer(11); tl.seek(at(5, 330));
  const late = tl.state.shoots.filter((q) => !q.dead && q.bornYear === 5 && q.bornDay > at(5, 185));
  assert.ok(late.length > 10, `pozdních výhonků ${late.length}`);
  assert.ok(late.every((q) => (q.dormant ?? 0) > 0), 'mají spící pupeny');
  assert.ok(late.filter((q) => !q.tipCut).every((q) => q.buds.length > 0), 'mají vrcholový pupen');
  tl.seek(at(6, 180));
  const ids = new Set(late.map((q) => q.id));
  const alive = tl.state.shoots.filter((q) => ids.has(q.id) && !q.dead).length;
  assert.ok(alive > late.length * 0.9, `přežilo ${alive} z ${late.length}`);
});

test('rozdělení uvnitř oblouku nadrátované větve nezmění tvar a drát zůstane na obou částech', () => {
  const tl = new Timeline(4, [{ day: 300, type: 'repot', pot: 'training', potId: 't10', prune: 0 }], 10, 'pine'); tl.seek(at(6, 320));
  const sh = tl.state.shoots.filter((q) => !q.dead && !q.elong && q.kind === 'shoot' && q.order === 1 && q.len > 6)[0];
  tl.act({ type: 'wire', shoot: sh.id, axis: norm(cross(sh.dir, [0, 1, 0])), angle: 0.6, z: 1 });
  const s = tl.state;
  const fr0 = computeFrames(s);
  const tip0 = new Map(s.shoots.map((q, i) => [q.id, [fr0.tip[i * 3], fr0.tip[i * 3 + 1], fr0.tip[i * 3 + 2]]]));
  const a0 = s.shoots.find((q) => q.id === sh.id)!.arc!.angle;
  const out = splitShoot(s, sh.id, 0.4, true)!;
  const inner = s.shoots.find((q) => q.id === sh.id)!;
  assert.ok(inner.arc && out.arc && Math.abs(inner.arc.angle + out.arc.angle - a0) < 1e-9, 'úhel se rozdělí');
  assert.ok(inner.wire && out.wire, 'drát na obou částech');
  const fr = computeFrames(s);
  s.shoots.forEach((q, i) => {
    const want = tip0.get(q.id === sh.id ? -1 : q.id === out.id ? sh.id : q.id);
    if (!want) return;
    assert.ok(Math.hypot(fr.tip[i * 3] - want[0], fr.tip[i * 3 + 1] - want[1], fr.tip[i * 3 + 2] - want[2]) < 1e-3, `výhon ${q.id} se posunul`);
  });
});

test('druhý ohyb uprostřed ohnuté větve: část před ním stojí, zakřivení za rukou zůstane', () => {
  const tl = new Timeline(4, [{ day: 300, type: 'repot', pot: 'training', potId: 't10', prune: 0 }], 10, 'pine'); tl.seek(at(6, 320));
  const sh = tl.state.shoots.filter((q) => !q.dead && !q.elong && q.kind === 'shoot' && q.order === 1 && q.len > 6)[0];
  const ax = norm(cross(sh.dir, [0, 1, 0]));
  tl.act({ type: 'wire', shoot: sh.id, axis: ax, angle: 0.5, z: 1 });
  const L = tl.state.shoots.find((q) => q.id === sh.id)!.len;
  const fr0 = computeFrames(tl.state), i0 = fr0.index.get(sh.id)!;
  const p03 = shootPoint(tl.state.shoots[i0], 0.3);
  const n0 = tl.state.shoots.length;
  // ohyb mezi 0,3 a 0,6 délky opačným směrem
  tl.act({ type: 'wire', shoot: sh.id, at: 0.3, to: (0.6 - 0.3) / 0.7, axis: [-ax[0], -ax[1], -ax[2]], angle: 0.4, z: 1 });
  const s = tl.state;
  assert.equal(s.shoots.length, n0 + 2);
  const a = s.shoots.find((q) => q.id === sh.id)!, m = s.shoots.find((q) => q.parent === a.id && q.split)!, e = s.shoots.find((q) => q.parent === m.id && q.split)!;
  assert.ok(Math.abs(a.len - L * 0.3) < 1e-9 && Math.abs(m.len - L * 0.3) < 1e-9 && Math.abs(e.len - L * 0.4) < 1e-9, 'délky částí');
  const fr = computeFrames(s), ia = fr.index.get(a.id)!;
  assert.ok(Math.hypot(fr.tip[ia * 3] - (fr0.base[i0 * 3] + p03[0]), fr.tip[ia * 3 + 1] - (fr0.base[i0 * 3 + 1] + p03[1]), fr.tip[ia * 3 + 2] - (fr0.base[i0 * 3 + 2] + p03[2])) < 1e-3, 'část před ohybem stojí');
  assert.ok(e.arc && Math.abs(e.arc.angle - 0.5 * 0.4) < 1e-9, `konec si nese původní zakřivení (${e.arc?.angle})`);
  assert.ok(m.wire && e.wire && a.wire, 'drát na všech částech');
  tl.undo();
  assert.equal(tl.state.shoots.length, n0);
});

// ---- pravidla v12: plevel
test('v12: plevel nalétne v nádobě, zabírá kořenům místo a po odplevelení se místo uvolní', () => {
  const tl = new Timeline(4, [{ day: 300, type: 'repot', pot: 'bonsai', potId: 'b25', prune: 0 }], 12, 'maple');
  tl.seek(at(1, 300));
  const n1 = (tl.state.weeds ?? []).length;
  tl.seek(at(5, 250));
  const ws = tl.state.weeds ?? [];
  assert.ok(n1 <= 2 && ws.length >= 2 && ws.length <= 8, `za rok ${n1}, za pět let ${ws.length}`);
  const load = weedLoad(tl.state) / tl.state.potCap;
  assert.ok(load > 0.03 && load < 0.3, `plevel zabírá ${(load * 100).toFixed(0)} %`);
  const f0 = rootFill(tl.state);
  const one = ws[0];
  tl.act({ type: 'weed', id: one.id });
  assert.equal((tl.state.weeds ?? []).length, ws.length - 1);
  assert.ok(rootFill(tl.state) < f0, 'vytržení jedné rostliny ubere');
  tl.act({ type: 'weed' });
  assert.equal((tl.state.weeds ?? []).length, 0);
  assert.ok(Math.abs(rootFill(tl.state) - (f0 - load)) < 1e-9, 'po odplevelení zbudou jen kořeny stromu');
  tl.undo(); tl.undo();
  assert.equal((tl.state.weeds ?? []).length, ws.length);
  // přesazení do čerstvého substrátu plevel odstraní, volná půda ho nemá
  tl.act({ type: 'repot', pot: 'bonsai', potId: 'b25', prune: 0.3 });
  assert.equal((tl.state.weeds ?? []).length, 0);
  const g = new Timeline(4, [{ day: 300, type: 'repot', pot: 'ground', potId: 'ground', prune: 0 }], 12, 'maple'); g.seek(at(5, 250));
  assert.equal((g.state.weeds ?? []).length, 0);
});

test('v12: plevel nemění čísla výhonů – bez plevele roste strom stejně jako ve v11', () => {
  const a = new Timeline(4, [{ day: 300, type: 'repot', pot: 'ground', potId: 'ground', prune: 0 }], 11, 'maple'); a.seek(at(4, 200));
  const b = new Timeline(4, [{ day: 300, type: 'repot', pot: 'ground', potId: 'ground', prune: 0 }], 12, 'maple'); b.seek(at(4, 200));
  assert.equal(JSON.stringify(a.state.shoots), JSON.stringify(b.state.shoots));
});

test('misky: každý tvar ve více objemech, staré misky z katalogu beze změny', () => {
  const ids = POTS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'čísla nádob se neopakují');
  // starší misky (uložené hry) mají stále stejné rozměry a objem
  assert.deepEqual([potById('b15').a, potById('b15').b, potById('b15').h, potById('b15').liters], [27, 19, 5, 1.5]);
  assert.deepEqual([potById('b12').a, potById('b12').liters], [52, 12]);
  for (const f of POT_FAMILIES) {
    const vols = POT_VOLUMES.filter((L) => potOf(f.id, L));
    assert.ok(vols.length >= 3, `${f.name}: aspoň tři objemy (${vols.length})`);
    for (const L of vols) {
      const p = potOf(f.id, L)!;
      assert.equal(p.type, 'bonsai'); assert.equal(p.liters, L);
      // větší objem = větší miska (stejný tvar)
      const prev = vols[vols.indexOf(L) - 1];
      if (prev !== undefined) assert.ok(p.a > potOf(f.id, prev)!.a, `${f.name} ${L} l je širší než ${prev} l`);
    }
  }
  // tam, kde starší miska do mřížky zapadne, se použije ona (žádný dvojník)
  assert.equal(potOf('rect', 1.5)!.id, 'b15');
  assert.equal(potOf('rect', 2.5)!.id, 'b25');
  // nová miska funguje v přesazení a kapacita roste s objemem
  const t = new Timeline(4, [{ day: 300, type: 'repot', pot: 'bonsai', potId: potOf('mokko', 4)!.id, prune: 0 }], 12, 'maple');
  t.seek(at(2, 200));
  assert.equal(t.state.potId, 'b-mokko-4');
  const small = new Timeline(4, [{ day: 300, type: 'repot', pot: 'bonsai', potId: 'b15', prune: 0 }], 12, 'maple'); small.seek(at(2, 200));
  assert.ok(t.state.potCap > small.state.potCap * 2, 'miska 4 l pojme víc kořenů než 1,5 l');
});

test('v13: po zkrácení javoru v době růstu vyrůstají výhonky u řezu, ne ve vzduchu za koncem větve', () => {
  const Y = YEAR;
  const run = (rules: number) => {
    const base: Action[] = [{ day: 300, type: 'repot', pot: 'training', potId: 't5', prune: 0 }];
    const probe = new Timeline(4, base, rules, 'maple');
    probe.seek(at(3, 130));
    // několik olistěných výhonů zkrácených na třetinu (u části z nich se založí pupeny druhého rašení)
    const ids = probe.state.shoots.filter((x) => !x.dead && x.parent >= 0 && x.len > 5 && x.needleCount > 0).slice(0, 8).map((x) => x.id);
    const cuts: Action[] = ids.map((id) => ({ day: at(3, 131), type: 'cut', shoot: id, t: 0.33 }));
    const t = new Timeline(4, [...base, ...cuts], rules, 'maple');
    t.seek(at(3, 132));
    const pinch = t.state.shoots.flatMap((x) => x.buds.filter((b) => b.kind === 'pinch').map((b) => b.t));
    t.seek(at(3, 132) + Y);
    const maxAttach = Math.max(...t.state.shoots.map((x) => x.attachT));
    return { pinch, maxAttach };
  };
  const old = run(12), now = run(13);
  assert.ok(old.pinch.length > 0 && now.pinch.length > 0, 'řez založil pupeny druhého rašení');
  assert.ok(Math.max(...old.pinch) > 1.5, 've v12 skončily pupeny za koncem výhonu (chyba, kterou v13 opravuje)');
  assert.ok(Math.max(...now.pinch) <= 1 + 1e-9, `v13: pupeny na výhonu (max ${Math.max(...now.pinch)})`);
  assert.ok(now.maxAttach <= 1 + 1e-9, `v13: žádný výhon za koncem rodiče (max ${now.maxAttach})`);
});

console.log(`\n${n} testů prošlo`);
