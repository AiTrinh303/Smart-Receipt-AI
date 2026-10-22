const esbuild = require('esbuild')

const LOADER_BY_EXTENSION = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.jsx': 'jsx',
}

module.exports = {
  process(sourceText, sourcePath) {
    const extension = sourcePath.slice(sourcePath.lastIndexOf('.'))
    const loader = LOADER_BY_EXTENSION[extension] ?? 'js'

    const { code, map } = esbuild.transformSync(sourceText, {
      loader,
      format: 'cjs',
      target: 'node18',
      jsx: 'automatic',
      sourcefile: sourcePath,
      sourcemap: true,
      // Force dynamic import() down to a require()-based equivalent: esbuild
      // otherwise leaves it as native import() syntax (since node18 supports
      // it natively), but Jest's CJS/vm sandbox can't evaluate that without
      // --experimental-vm-modules, which this project doesn't configure.
      supported: { 'dynamic-import': false },
      define: {
        'import.meta.env.VITE_API_URL': JSON.stringify(
          process.env.VITE_API_URL || 'http://localhost:8001',
        ),
        'import.meta.env.DEV': 'true',
      },
    })

    return { code, map }
  },
}
