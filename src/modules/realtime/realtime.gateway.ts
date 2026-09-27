import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { UseGuards } from '@nestjs/common';
import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@WebSocketGateway({
  cors: {
    origin: process.env['FRONTEND_URL'] || 'http://localhost:5173',
    credentials: true,
  },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly connectedClients = new Map<string, { userId: string; boards: Set<string> }>();

  constructor(private jwtService: JwtService) {}

  handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];
      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      this.connectedClients.set(client.id, { userId: payload.sub, boards: new Set() });
      console.log(`Client connected: ${client.id} (user: ${payload.sub})`);
    } catch (err) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.connectedClients.delete(client.id);
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinBoard')
  handleJoinBoard(@ConnectedSocket() client: Socket, @MessageBody() data: { boardId: string }) {
    const clientData = this.connectedClients.get(client.id);
    if (clientData) {
      clientData.boards.add(data.boardId);
      void client.join(`board:${data.boardId}`);
      console.log(`Client ${client.id} joined board ${data.boardId}`);
    }
  }

  @SubscribeMessage('leaveBoard')
  handleLeaveBoard(@ConnectedSocket() client: Socket, @MessageBody() data: { boardId: string }) {
    const clientData = this.connectedClients.get(client.id);
    if (clientData) {
      clientData.boards.delete(data.boardId);
      void client.leave(`board:${data.boardId}`);
      console.log(`Client ${client.id} left board ${data.boardId}`);
    }
  }

  // Broadcast methods for other services to use
  broadcastToBoard(boardId: string, event: string, data: unknown) {
    this.server.to(`board:${boardId}`).emit(event, data);
  }

  broadcastToUser(userId: string, event: string, data: unknown) {
    for (const [clientId, clientData] of this.connectedClients.entries()) {
      if (clientData.userId === userId) {
        this.server.to(clientId).emit(event, data);
      }
    }
  }
}
