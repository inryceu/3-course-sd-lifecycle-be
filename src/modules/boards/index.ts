/** Public API of the boards module. Other modules import only from here. */
export { BoardsModule } from './boards.module';
export { BOARDS_FACADE } from './application/boards-facade.port';
export type { BoardsFacade } from './application/boards-facade.port';
export { BoardRole } from './domain/board-role';
