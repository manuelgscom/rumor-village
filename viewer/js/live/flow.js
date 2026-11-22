// The steps of the text input, without DOM: understand first, drop after.
// Nothing reaches the village without showing first what was understood.
//
//   mode 'extract' (the run has an extract task)
//     sentence ─POST extract─► «Entendido: …» ─[Soltar] POST inject {fact, text, to}
//                  │ 501
//                  └──► mode 'fields'
//   mode 'fields' (baseline: no extractor)
//     fields ─POST inject dryRun─► «Entendido: …» ─[Soltar] POST inject {fact, to}
//
//   phase: idle → busy → understood → busy → dropped
//                   └──► error (the server's message, 409, network)
//
// After a drop the viewer follows the new rumor (createFollow): the engine
// does not answer with its id, so it is the first `inject` that reaches the
// store from the moment [Soltar] was pressed.

import { amountLabel, answerNotes, extractedBody, injectBody } from './inject.js';

/**
 * @typedef {object} FlowState
 * @property {'extract'|'fields'} mode
 * @property {'idle'|'busy'|'understood'|'dropped'|'error'} phase
 * @property {string|null} understood the server's «Entendido: …»
 * @property {string[]} notes empty and unknown slots
 * @property {string|null} error
 * @property {string|null} droppedAt place it was dropped at
 */

/**
 * Creates the flow.
 * @param {{
 *   api: ReturnType<typeof import('./api.js').createApi>,
 *   lang: string,
 *   text: object strings.js of the language,
 *   extract?: boolean,
 *   onChange?: (state: FlowState) => void,
 * }} opts
 */
export function createFlow({ api, lang, text, extract = false, onChange = () => {} }) {
  /** @type {FlowState} */
  const state = {
    mode: extract ? 'extract' : 'fields',
    phase: 'idle',
    understood: null,
    notes: [],
    error: null,
    droppedAt: null,
  };
  let pending = null; // what was understood: {fact, text} or the fields body
  let seq = 0; // newer requests win over older answers

  const set = (patch) => {
    Object.assign(state, patch);
    onChange(state);
  };

  const errorOf = (reply) => {
    if (reply.status === 409) return text.ended409;
    if (reply.status === 0) return text.network;
    return `${text.error} ${reply.status}: ${reply.error}`;
  };

  const notesOf = (answer, what) => answerNotes(answer, text, amountLabel(what, lang, text));

  const fail = (message) => {
    pending = null;
    set({ phase: 'error', error: message, understood: null, notes: [] });
    return state;
  };

  return {
    state,

    /** Switches to the extractor or to the fields (the run's GET control). */
    setExtract(on) {
      pending = null;
      set({ mode: on ? 'extract' : 'fields', phase: 'idle', error: null, understood: null, notes: [] });
    },

    /**
     * First step: what the engine understands.
     * @param {{text: string}|import('./inject.js').Fields} input the sentence
     *   (mode extract) or the fields (mode fields)
     * @returns {Promise<FlowState>}
     */
    async understand(input) {
      const my = ++seq;
      pending = null;
      if (state.mode === 'extract') {
        const sentence = (input?.text ?? '').trim();
        if (!sentence) return fail(text.needWhat);
        set({ phase: 'busy', error: null, understood: null, notes: [], droppedAt: null });
        const reply = await api.extract(sentence);
        if (my !== seq) return state;
        if (reply.status === 501) {
          set({ mode: 'fields', phase: 'idle' });
          return state;
        }
        if (!reply.ok) return fail(errorOf(reply));
        const answer = reply.body ?? {};
        if (!answer.fact) {
          set({ phase: 'error', understood: answer.understood ?? null, notes: notesOf(answer, null), error: text.noFact });
          return state;
        }
        pending = { fact: answer.fact, text: sentence };
        set({ phase: 'understood', understood: answer.understood, notes: notesOf(answer, answer.fact.what) });
        return state;
      }

      let body;
      try {
        body = injectBody(input ?? {}, lang, { dryRun: true });
      } catch (err) {
        return fail(err.message === 'to' ? text.needTo : text.needWhat);
      }
      set({ phase: 'busy', error: null, understood: null, notes: [], droppedAt: null });
      const reply = await api.inject(body);
      if (my !== seq) return state;
      if (!reply.ok) return fail(errorOf(reply));
      delete body.dryRun;
      pending = body;
      set({ phase: 'understood', understood: reply.body?.understood ?? '', notes: notesOf(reply.body, input?.what) });
      return state;
    },

    /**
     * Second step: drops what was understood on the people at `to`.
     * @param {string} [to] place; in mode fields, the one of the understood body when not given
     * @returns {Promise<FlowState>}
     */
    async drop(to) {
      if (state.phase !== 'understood' || !pending) return state;
      const my = ++seq;
      const body =
        state.mode === 'extract'
          ? extractedBody(pending.fact, pending.text, to)
          : { ...pending, to: { place: to || pending.to.place } };
      if (!body.to.place) return fail(text.needTo);
      set({ phase: 'busy', error: null });
      const reply = await api.inject(body);
      if (my !== seq) return state;
      if (!reply.ok) return fail(errorOf(reply));
      pending = null;
      set({ phase: 'dropped', droppedAt: body.to.place });
      return state;
    },

    /** The input changed: what was understood no longer holds. */
    edit() {
      if (state.phase === 'idle') return;
      ++seq;
      pending = null;
      set({ phase: 'idle', understood: null, notes: [], error: null });
    },

    /** The body that [Soltar] would send now (for the tests and the UI). */
    get pending() {
      return pending;
    },
  };
}

/**
 * Follows the rumor just dropped: arm(from) when [Soltar] is pressed, with the
 * number of events in the store then; check(events) after each append calls
 * onFact with the id of the first `inject` from there, once.
 * @param {(fact: string) => void} onFact
 */
export function createFollow(onFact) {
  let from = null;
  const follow = {
    /** @param {number} index events already in the store when it was dropped */
    arm(index) {
      from = Math.max(0, index);
    },
    /** Forgets a drop that failed. */
    disarm() {
      from = null;
    },
    get armed() {
      return from !== null;
    },
    /**
     * @param {{type: string, fact?: string}[]} events the store's events
     * @returns {string|null} the fact followed now, if any
     */
    check(events) {
      if (from === null) return null;
      for (let i = from; i < events.length; i++) {
        if (events[i].type === 'inject' && events[i].fact) {
          from = null;
          onFact(events[i].fact);
          return events[i].fact;
        }
      }
      from = events.length;
      return null;
    },
  };
  return follow;
}
