module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\.spec\.ts$',
  transform: {
    '^.+\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary', 'html'],
  // Agreed in the backlog index (T-40 / KAN-51): >= 70 % lines for the whole repo. The >= 85 % rule
  // for the auth and jira-sync services is checked by scripts/check-service-coverage.js, because a
  // Jest path/glob threshold would take those files out of the global pool.
  coverageThreshold: {
    global: { lines: 70 },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@modules/(.*)$': '<rootDir>/modules/$1',
    '^@common/(.*)$': '<rootDir>/common/$1',
    '^@config/(.*)$': '<rootDir>/config/$1',
  },
};
