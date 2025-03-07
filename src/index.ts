import { Api, start } from './api.js';
import { defaults, HeadlessState, State } from './state.js';
import { renderWrap } from './wrap.js';
import * as util from './util.js';
import { render } from './render.js';

export function CommanderChessBoard(element: HTMLElement, config?: any): Api {
  console.log('CommanderChessBoard');
  const maybeState: HeadlessState = { ...defaults(), ...config };
  function redrawAll(): State {
    const elements = renderWrap(element, maybeState),
      bounds = util.memo(() => elements.board.getBoundingClientRect());
    const state = maybeState as State;
    state.dom = {
      elements,
      bounds,
    };
    render(state);
    return state;
  }
  return start(redrawAll(), redrawAll);
}
