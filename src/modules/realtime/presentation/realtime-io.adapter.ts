import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { RealtimeConfig } from '../../../config/configuration';
/**
 * Socket.IO adapter that applies the frontend origin as the CORS policy of the realtime server
 * and the configured heartbeat (see docs/api/ws-events.md).
 */
export class RealtimeIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly frontendUrl: string,
    private readonly heartbeat: RealtimeConfig,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.frontendUrl, credentials: true },
      pingInterval: this.heartbeat.pingIntervalMs,
      pingTimeout: this.heartbeat.pingTimeoutMs,
    });
  }
}
