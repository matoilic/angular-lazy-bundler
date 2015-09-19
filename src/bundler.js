import Builder from 'systemjs-builder';
import _ from 'lodash';
import glob from 'glob';
import path from 'path';

const defaultOptions = {
    sourceRoot: 'build',
    dest: 'build/bundles',
    sourceMaps: true,
    minify: true
};

class Bundler {
    constructor(options) {
        this.options = _.merge({}, options, defaultOptions);
    }

    bundle() {

    }

    run() {
        glob
            .sync(path.join(this.options.sourceRoot, '**', 'index.js'));
    }
}

export default Bundler;
