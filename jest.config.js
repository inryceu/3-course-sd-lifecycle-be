module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  roots: ['<rootDir>', '<rootDir>/../test/system/support'],
  testRegex: '.*\.spec\.ts$',
  transform: {
    '^.+\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary', 'html'],
  // Backlog index (T-40 / KAN-51): >= 70 % lines for the whole repo; raised to 75 % by KAN-66
  // (measured 78 %). The per-module rules (auth/jira-sync services 85 %, boards services 80 % and
  // module 90 %) are checked by scripts/check-service-coverage.mjs, because a Jest path/glob
  // threshold would take those files out of the global pool.
  coverageThreshold: {
    global: { lines: 75 },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@modules/(.*)$': '<rootDir>/modules/$1',
    '^@common/(.*)$': '<rootDir>/common/$1',
    '^@config/(.*)$': '<rootDir>/config/$1',
  },
};
