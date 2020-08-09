module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverage: true,
  coverageProvider: 'v8',
  errorOnDeprecated: true,
  modulePathIgnorePatterns: ['build', '__tests__/utilities'],
};
