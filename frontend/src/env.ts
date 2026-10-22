/** Isolated in its own module so tests can `jest.mock('./env')` to flip it,
 * since `import.meta.env.DEV` itself is a compile-time constant that can't
 * be toggled at runtime within a single test run. */
export const isDev = import.meta.env.DEV
