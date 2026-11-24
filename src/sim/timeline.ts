// Časová osa = event sourcing. Uchovává jen semínko a deník zásahů; stav stromu k libovolnému
// datu se dopočítá přehráním simulace (se snapshoty po rocích kvůli rychlosti).

import type { Action, ActionInput, State } from './types';
import { MAX_YEARS, RULES_LATEST, START_DOY } from './params';
import { createState, step } from './growth';
import { applyAction } from './actions';
import { YEAR, doyOf } from './util';

export class Timeline {
  readonly seed: number;
  readonly minDay = START_DOY;
  readonly maxDay = MAX_YEARS * YEAR - 1;
  actions: Action[] = [];
  state: State;
  /** snapshoty stavu "ráno před zásahy" daného dne */
  private snaps = new Map<number, State>();

  readonly rules: number;

  readonly species: string;

  constructor(seed: number, actions: Action[] = [], rules = RULES_LATEST, species = 'pine') {
    this.rules = rules;
    this.species = species;
    this.seed = seed;
    this.actions = actions.slice().sort((a, b) => a.day - b.day);
    this.state = createState(seed, rules, species);
    this.snaps.set(this.state.day, structuredClone(this.state));
    this.applyAt(this.state.day);
  }

  get day() { return this.state.day; }

  private applyAt(day: number) {
    for (const a of this.actions) if (a.day === day) applyAction(this.state, a);
  }

  private restore(day: number) {
    let best = this.minDay;
    for (const d of this.snaps.keys()) if (d <= day && d > best) best = d;
    this.state = structuredClone(this.snaps.get(best)!);
    this.applyAt(best);
  }

  /** Přesune simulaci na daný den (dopředu krokuje, dozadu přehraje od nejbližšího snapshotu). */
  seek(day: number) {
    day = Math.max(this.minDay, Math.min(this.maxDay, Math.round(day)));
    if (day < this.state.day) this.restore(day);
    while (this.state.day < day) {
      step(this.state);
      if (doyOf(this.state.day) === 0) this.snaps.set(this.state.day, structuredClone(this.state));
      this.applyAt(this.state.day);
    }
  }

  private dropSnapsAfter(day: number) {
    for (const d of [...this.snaps.keys()]) if (d > day) this.snaps.delete(d);
  }

  /** Počet pozdějších zásahů, které by nový zásah v minulosti přepsal. */
  futureActions() { return this.actions.filter((a) => a.day > this.state.day).length; }

  /** Provede zásah dnes. Zásah v minulosti zahodí pozdější zásahy (větvení historie). */
  act(input: ActionInput) {
    const a = { ...input, day: this.state.day } as Action;
    this.actions = this.actions.filter((x) => x.day <= a.day);
    this.actions.push(a);
    this.dropSnapsAfter(a.day);
    applyAction(this.state, a);
  }

  undo(): Action | undefined {
    const a = this.actions.pop();
    if (!a) return;
    const day = this.state.day;
    this.dropSnapsAfter(a.day);
    this.restore(Math.min(day, a.day));
    this.seek(day);
    return a;
  }
}
