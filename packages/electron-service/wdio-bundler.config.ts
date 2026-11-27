import type { BundlerConfig } from '@wdio/bundler';

const config: BundlerConfig = {
  transformations: [
    {
      type: 'injectDependency',
      options: {
        packageName: 'fast-copy',
        targetFile: 'src/service.ts',
        bundleRegExp: /export.*$/m,
        importName: '{ copy: fastCopy }',
        bundleReplace: (importName) => `const ${importName} = { default: index };`,
      },
    },
    {
      type: 'injectDependency',
      options: {
        packageName: '@wdio/native-spy',
        targetFile: 'src/mock.ts',
        bundleRegExp: /export\s*\{\s*([^}]+)\s*\}\s*;/,
        importName: 'spy',
        bundleReplace: (importName: string) => `const ${importName} = { $1 };`,
      },
    },
    {
      type: 'injectDependency',
      options: {
        packageName: '@wdio/native-spy',
        targetFile: 'src/classMock.ts',
        bundleRegExp: /export\s*\{\s*([^}]+)\s*\}\s*;/,
        importName: 'spy',
        bundleReplace: (importName: string) => `const ${importName} = { $1 };`,
      },
    },
  ],
  // native-spy is a dependency only for the published types. Its subpaths stay external unless listed.
  esm: {
    bundle: ['@wdio/native-spy', '@wdio/native-spy/interceptor'],
  },
  cjs: {
    bundle: ['fast-copy', '@wdio/native-spy', '@wdio/native-spy/interceptor'],
  },
};

export default config;
