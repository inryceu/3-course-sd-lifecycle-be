const skipped = new WeakSet<object>();

/**
 * Exempts one supertest request from the automatic OpenAPI response check. Only for tests that
 * assert a route is deliberately NOT part of the API (the contract cannot describe its 404).
 */
export const undocumentedRoute = <T extends object>(req: T): T => {
  skipped.add(req);
  return req;
};

export const isUndocumentedRoute = (req: object): boolean => skipped.has(req);
