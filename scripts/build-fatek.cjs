const esbuild = require('esbuild');
esbuild.buildSync({ entryPoints: ['integrations/fatek/adapter.js'], outfile: 'dist/fatek-client.js',
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  sourcemap: false, legalComments: 'eof', supported: { 'template-literal': false } });
