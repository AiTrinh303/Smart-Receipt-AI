/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(png|jpg|jpeg|gif|svg|webp|avif)$': '<rootDir>/src/test/fileMock.cjs',
  },
  transform: {
    '^.+\\.(t|j)sx?$': '<rootDir>/jest.esbuild-transform.cjs',
  },
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
}
