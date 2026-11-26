/**
 * Rate limits read from the environment on every request, so a deployment (or a test stack)
 * can tune them without a rebuild. Defaults are the production values from T-36.
 */
const positiveInt = (name: string, fallback: number): number => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const MINUTE = 60_000;
const FIVE_MINUTES = 5 * MINUTE;

/** Every throttled route: requests per client per minute. */
export const globalLimit = () => positiveInt('RATE_LIMIT_PER_MINUTE', 100);
/** POST /auth/register: attempts per client per 5 minutes. */
export const registerLimit = () => positiveInt('RATE_LIMIT_REGISTER', 5);
/** POST /auth/login: attempts per client per 5 minutes. */
export const loginLimit = () => positiveInt('RATE_LIMIT_LOGIN', 10);

export const RATE_LIMIT_WINDOWS = { global: MINUTE, auth: FIVE_MINUTES } as const;
