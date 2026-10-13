/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'api-must-not-import-ui-components',
      comment:
        'src/api/ holds API call modules and shared types; it must never import a UI ' +
        'component file (a .tsx file directly under src/, e.g. ReceiptUpload.tsx, ' +
        'ReceiptResult.tsx, App.tsx), so the dependency direction stays ' +
        'UI components -> src/api -> types.',
      severity: 'error',
      from: { path: '^src/api' },
      to: { path: '^src/[^/]+\\.tsx$' },
    },
  ],
  options: {
    tsConfig: {
      fileName: 'tsconfig.app.json',
    },
    doNotFollow: {
      path: 'node_modules',
    },
  },
}
