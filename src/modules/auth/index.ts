/** Public API of the auth module. Other modules import only from here. */
export { AuthModule } from './auth.module';
export { AUTH_FACADE } from './application/auth-facade.port';
export type { AuthFacade } from './application/auth-facade.port';
export type { AuthUser } from './domain/auth-user';
export { Public } from '../../common/decorators/public.decorator';
export { CurrentUser } from './presentation/decorators/current-user.decorator';
