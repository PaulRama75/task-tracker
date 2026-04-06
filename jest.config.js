module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.js', '**/*.test.js'],
  collectCoverageFrom: [
    '*.js',
    'middleware/**/*.js',
    'routes/**/*.js',
    'shared/**/*.js',
    '!jest.config.js',
    '!node_modules/**'
  ],
  coverageDirectory: 'coverage',
  verbose: true
};
