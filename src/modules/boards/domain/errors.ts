/** A card may only move to a column of its own board. */
export class CrossBoardMoveError extends Error {
  constructor() {
    super('A card can only be moved to a column of the same board');
    this.name = 'CrossBoardMoveError';
  }
}

/** A position must be a non-negative integer within the container. */
export class InvalidPositionError extends Error {
  constructor(message = 'Position must be a non-negative integer') {
    super(message);
    this.name = 'InvalidPositionError';
  }
}
