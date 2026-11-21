import path from 'path';
import jestOpenAPI from 'jest-openapi';
import Test from 'supertest/lib/test';
import { isUndocumentedRoute } from './openapi-skip';

jestOpenAPI(path.join(__dirname, '../docs/api/openapi.yaml'));

/**
 * Validates EVERY supertest response in the e2e suites against docs/api/openapi.yaml (status
 * code, headers, body, error bodies included), so a contract drift fails the test that hit it.
 * It runs after the test's own `.expect(...)` checks passed, and driven only by the spec, so
 * endpoints added later are covered as soon as they are documented.
 */
type Done = (error: Error | null, res: unknown) => void;
// `assert` is supertest's internal hook, called once per finished request; not in its typings.
const proto = Test.prototype as unknown as {
  assert: (this: unknown, resError: unknown, res: unknown, fn: Done) => void;
};
const assertOriginal = proto.assert;

proto.assert = function assertWithSpec(resError, res, fn) {
  assertOriginal.call(this, resError, res, (error, response) => {
    let failure = error;
    if (!failure && response && !isUndocumentedRoute(this as object)) {
      try {
        expect(response).toSatisfyApiSpec();
      } catch (specError) {
        failure = specError as Error;
      }
    }
    fn.call(this, failure, response);
  });
};
