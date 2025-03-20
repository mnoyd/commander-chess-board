import { HeadlessState } from './state';
import { allPos, computeSquareCenter, opposite, pos2key } from './util.js';
import * as cg from './types.js';
import { premove } from './premove.js';
import { canCombine, combinePieces } from './combined-pieces.js';

export function toggleOrientation(state: HeadlessState): void {
  state.orientation = opposite(state.orientation);
}
export function callUserFunction<T extends (...args: any[]) => void>(
  f: T | undefined,
  ...args: Parameters<T>
): void {
  if (f) setTimeout(() => f(...args), 1);
}
export function setCheck(state: HeadlessState, color: cg.Color | boolean): void {
  state.check = undefined;
  if (color === true) color = state.turnColor;
  if (color)
    for (const [k, p] of state.pieces) {
      //TODO: Should hight light check for both navy and air_force as well
      if (p.role === 'commander' && p.color === color) {
        state.check = k;
      }
    }
}

export function setSelected(state: HeadlessState, key: cg.Key): void {
  state.selected = key;
  if (isPremovable(state, key)) {
    // calculate chess premoves if custom premoves are not passed
    if (!state.premovable.customDests) {
      state.premovable.dests = premove();
    }
  } else state.premovable.dests = undefined;
}

function isPremovable(state: HeadlessState, orig: cg.Key): boolean {
  const piece = state.pieces.get(orig);
  return (
    !!piece &&
    state.premovable.enabled &&
    state.movable.color === piece.color &&
    state.turnColor !== piece.color
  );
}
export function unselect(state: HeadlessState): void {
  state.selected = undefined;
  state.premovable.dests = undefined;
  state.hold.cancel();
}

export const canMove = (state: HeadlessState, orig: cg.Key, dest: cg.Key): boolean =>
  orig !== dest &&
  isMovable(state, orig) &&
  (state.movable.free || !!state.movable.dests?.get(orig)?.includes(dest));

function isMovable(state: HeadlessState, orig: cg.Key): boolean {
  const piece = state.pieces.get(orig);
  return (
    !!piece &&
    (state.movable.color === 'both' ||
      (state.movable.color === piece.color && state.turnColor === piece.color))
  );
}
export function baseMove(state: HeadlessState, orig: cg.Key, dest: cg.Key): cg.Piece | boolean {
  const origPiece = state.pieces.get(orig);
  const destPiece = state.pieces.get(dest);

  if (orig === dest || !origPiece) return false;

  // 1. Check for Same Color and Combination
  if (destPiece && destPiece.color === origPiece.color) {
    // Attempt to combine
    if (canCombine(destPiece, origPiece)) {
      // Combined piece needs to include the carried pieces as well
      const piecesToCarry = [origPiece, ...(origPiece.carrying || [])]; // Include origPiece and all it carries
      const combined = combinePieces(destPiece, piecesToCarry);
      if (combined) {
        state.pieces.delete(orig); // Remove the original piece (and carried)
        state.pieces.set(dest, combined); // Place combined at destination

        state.lastMove = [orig, dest];
        state.check = undefined;
        callUserFunction(state.events.move, orig, dest, undefined); // No capture
        callUserFunction(state.events.change);
        return true;
      }
    }
    // return false; // Combination failed
  }

  const captured = destPiece && destPiece.color !== origPiece.color ? destPiece : undefined;
  if (dest === state.selected) unselect(state);
  callUserFunction(state.events.move, orig, dest, captured);

  state.pieces.set(dest, origPiece);
  state.pieces.delete(orig);

  state.lastMove = [orig, dest];
  state.check = undefined;
  callUserFunction(state.events.change);
  return captured || true;
}

function baseUserMove(state: HeadlessState, orig: cg.Key, dest: cg.Key): cg.Piece | boolean {
  const result = baseMove(state, orig, dest);
  if (result) {
    state.movable.dests = undefined;
    state.turnColor = opposite(state.turnColor);
    state.animation.current = undefined;
  }
  return result;
}
export function userMove(state: HeadlessState, orig: cg.Key, dest: cg.Key): boolean {
  if (canMove(state, orig, dest)) {
    const result = baseUserMove(state, orig, dest);
    if (result) {
      const holdTime = state.hold.stop();
      unselect(state);
      const metadata: cg.MoveMetadata = {
        premove: false,
        ctrlKey: state.stats.ctrlKey,
        holdTime,
      };
      if (result !== true) metadata.captured = result;
      callUserFunction(state.movable.events.after, orig, dest, metadata);
      return true;
    }
  } else if (canPremove(state, orig, dest)) {
    setPremove(state, orig, dest, {
      ctrlKey: state.stats.ctrlKey,
    });
    unselect(state);
    return true;
  }
  unselect(state);
  return false;
}
export function unsetPredrop(state: HeadlessState): void {
  const pd = state.predroppable;
  if (pd.current) {
    pd.current = undefined;
    callUserFunction(pd.events.unset);
  }
}
function canPremove(state: HeadlessState, orig: cg.Key, dest: cg.Key): boolean {
  const validPremoves: cg.Key[] = state.premovable.customDests?.get(orig) ?? premove();
  return orig !== dest && isPremovable(state, orig) && validPremoves.includes(dest);
}

function setPremove(state: HeadlessState, orig: cg.Key, dest: cg.Key, meta: cg.SetPremoveMetadata): void {
  unsetPredrop(state);
  state.premovable.current = [orig, dest];
  callUserFunction(state.premovable.events.set, orig, dest, meta);
}
export function unsetPremove(state: HeadlessState): void {
  if (state.premovable.current) {
    state.premovable.current = undefined;
    callUserFunction(state.premovable.events.unset);
  }
}

export function cancelMove(state: HeadlessState): void {
  unsetPremove(state);
  unsetPredrop(state);
  unselect(state);
}

export function getKeyAtDomPos(
  pos: cg.NumberPair,
  asRed: boolean,
  bounds: DOMRectReadOnly,
): cg.Key | undefined {
  // Calculate the file (x-coordinate)
  const boardWidth = bounds.width;
  const fileWidth = boardWidth / 12; // 12 total lines, including decorative ones
  let file = Math.round((pos[0] - bounds.left) / fileWidth) - 1;

  // Calculate the rank (y-coordinate)
  const boardHeight = bounds.height;
  const rankHeight = boardHeight / 13; // 13 total lines, including decorative ones
  let rank = 11 - Math.round((pos[1] - bounds.top) / rankHeight) + 1;

  // Adjust for red perspective
  if (!asRed) {
    file = 10 - file;
    rank = 11 - rank;
  }

  // Check if it is inside the valid range
  if (file < 0 || file > 10 || rank < 0 || rank > 11) return undefined;

  return `${file}-${rank}`;
}

export const redPov = (s: HeadlessState): boolean => s.orientation === 'red';

export function getSnappedKeyAtDomPos(
  // orig: cg.Key,
  pos: cg.NumberPair,
  asRed: boolean,
  bounds: DOMRectReadOnly,
): cg.Key | undefined {
  const validSnapPos = allPos;
  const validSnapCenters = validSnapPos.map(pos2 => computeSquareCenter(pos2key(pos2), asRed, bounds));
  const validSnapDistances = validSnapCenters.map(pos2 => distanceSq(pos, pos2));
  const [, closestSnapIndex] = validSnapDistances.reduce(
    (a, b, index) => (a[0] < b ? a : [b, index]),
    [validSnapDistances[0], 0],
  );
  return pos2key(validSnapPos[closestSnapIndex]);
}

export const distanceSq = (pos1: cg.Pos, pos2: cg.Pos): number => {
  const dx = pos1[0] - pos2[0],
    dy = pos1[1] - pos2[1];
  return dx * dx + dy * dy;
};

export function selectSquare(state: HeadlessState, key: cg.Key, force?: boolean): void {
  callUserFunction(state.events.select, key);
  if (state.selected) {
    if (state.selected === key && !state.draggable.enabled) {
      unselect(state);
      state.hold.cancel();
      return;
    } else if ((state.selectable.enabled || force) && state.selected !== key) {
      if (userMove(state, state.selected, key)) {
        state.stats.dragged = false;
        return;
      }
    }
  }
  if (
    (state.selectable.enabled || state.draggable.enabled) &&
    (isMovable(state, key) || isPremovable(state, key))
  ) {
    setSelected(state, key);
    state.hold.start();
  }
}

export function isDraggable(state: HeadlessState, orig: cg.Key): boolean {
  const piece = state.pieces.get(orig);
  return (
    !!piece &&
    state.draggable.enabled &&
    (state.movable.color === 'both' ||
      (state.movable.color === piece.color && (state.turnColor === piece.color || state.premovable.enabled)))
  );
}

export function dropNewPiece(state: HeadlessState, orig: cg.Key, dest: cg.Key, force?: boolean): void {
  const piece = state.pieces.get(orig);
  if (piece && (canDrop(state, orig, dest) || force)) {
    state.pieces.delete(orig);
    baseNewPiece(state, piece, dest, force);
    callUserFunction(state.movable.events.afterNewPiece, piece.role, dest, {
      premove: false,
      predrop: false,
    });
  } else if (piece && canPredrop(state, orig, dest)) {
    setPredrop(state, piece.role, dest);
  } else {
    unsetPremove(state);
    unsetPredrop(state);
  }
  state.pieces.delete(orig);
  unselect(state);
}

function canDrop(state: HeadlessState, orig: cg.Key, dest: cg.Key): boolean {
  const piece = state.pieces.get(orig);
  return (
    !!piece &&
    (orig === dest || !state.pieces.has(dest)) &&
    (state.movable.color === 'both' ||
      (state.movable.color === piece.color && state.turnColor === piece.color))
  );
}

export function baseNewPiece(state: HeadlessState, piece: cg.Piece, key: cg.Key, force?: boolean): boolean {
  if (state.pieces.has(key)) {
    if (force) state.pieces.delete(key);
    else return false;
  }
  callUserFunction(state.events.dropNewPiece, piece, key);
  state.pieces.set(key, piece);
  state.lastMove = [key];
  state.check = undefined;
  callUserFunction(state.events.change);
  state.movable.dests = undefined;
  state.turnColor = opposite(state.turnColor);
  return true;
}

function canPredrop(state: HeadlessState, orig: cg.Key, dest: cg.Key): boolean {
  const piece = state.pieces.get(orig);
  const destPiece = state.pieces.get(dest);
  return (
    !!piece &&
    (!destPiece || destPiece.color !== state.movable.color) &&
    state.predroppable.enabled &&
    //TODO: add logic for pieces here
    state.movable.color === piece.color &&
    state.turnColor !== piece.color
  );
}

function setPredrop(state: HeadlessState, role: cg.Role, key: cg.Key): void {
  unsetPremove(state);
  state.predroppable.current = { role, key };
  callUserFunction(state.predroppable.events.set, role, key);
}
