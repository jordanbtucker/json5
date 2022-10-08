import {basename, dirname, resolve} from 'path'
import type {Configuration} from 'webpack'
import {browser} from './package.json'

const config: Configuration = {
  mode: 'production',
  entry: './src/index.ts',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'babel-loader',
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '...'],
  },
  output: {
    filename: basename(browser),
    library: {
      name: 'JSON5',
      type: 'umd',
    },
    path: resolve(dirname(browser)),
  },
  devtool: 'source-map',
  stats: 'errors-warnings',
}

export default config
