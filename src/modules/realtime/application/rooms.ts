/** Room naming shared by the gateway and the event listener (see docs/api/ws-events.md). */
export const boardRoom = (boardId: string): string => `board:${boardId}`;
export const userRoom = (userId: string): string => `user:${userId}`;
