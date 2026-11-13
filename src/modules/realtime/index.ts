/** Public API of the realtime module. Other modules import only from here. */
export { RealtimeModule } from './realtime.module';
export { RealtimeIoAdapter } from './presentation/realtime-io.adapter';
export { ORIGIN_SOCKET_HEADER, originSocketMiddleware } from './presentation/origin-socket';
