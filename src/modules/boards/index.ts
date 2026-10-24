/** Public API of the boards module. Other modules import only from here. */
export { BoardsModule } from './boards.module';
export { BOARDS_FACADE } from './application/boards-facade.port';
export type {
  BoardColumnSummary,
  BoardsFacade,
  BoardSummary,
  ExternalCardInput,
  ExternalCardMove,
  ExternalUpsertResult,
} from './application/boards-facade.port';
export { BoardRole, ColumnType } from './domain/board-role';
