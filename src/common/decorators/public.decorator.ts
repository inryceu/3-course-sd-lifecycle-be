import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route (or controller) out of the global authentication guard.
 * Lives in the shared kernel so any module can mark public routes without depending on auth.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
