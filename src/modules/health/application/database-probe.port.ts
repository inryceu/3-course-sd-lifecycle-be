/** Port for checking that the database answers. Implemented in the infrastructure layer. */
export const DATABASE_PROBE = Symbol('DATABASE_PROBE');

export interface DatabaseProbe {
  isUp(): Promise<boolean>;
}
