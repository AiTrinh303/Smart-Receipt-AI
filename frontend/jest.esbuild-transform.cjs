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
      define: {
        'import.meta.env.VITE_API_URL': JSON.stringify(
          process.env.VITE_API_URL || 'http://localhost:8001',
        ),
      },
    })

    return { code, map }
  },
}
