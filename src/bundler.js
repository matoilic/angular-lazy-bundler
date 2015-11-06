import Builder from 'systemjs-builder';
import SystemMock from './systemjs-mock';
import _ from 'lodash';
import glob from 'glob';
import path from 'path';
import Promise from 'bluebird';
import fs from 'fs-extra';

Promise.promisifyAll(fs);

const defaultOptions = {
    basePath: 'build',
    baseUrl: '.',
    bundlesBaseUrl: 'bundles',
    dest: 'build/bundles',
    systemJsConfig: 'config/system.js',
    sourceMaps: true,
    minify: true,
    tab: '  '
};

class Bundler {
    /**
     *
     * @param {Object} options - Bundler options.
     * @param {String} [options.basePath=build] - Where to search for components / index.js files.
     * @param {String} [options.baseUrl=.] - Base URL on the file system to use for bundling.
     * @param {String} [options.bundlesBaseUrl=.] - Path relative to the baseURL of SystemJS in the browser of the destination folder.
     * @param {String} [options.dest=build/bundles] - Destination path where the bundles resources will be written to.
     * @param {String} [options.systemJsConfig=config/system.js] - Path to the SystemJS configuration file.
     * @param {Boolean} [options.sourceMaps=true] - Enable / disable sourcemap generation.
     * @param {Boolean} [options.minify=true] - Enable / disable minification of bundled resources.
     * @param {Boolean} [options.tab=4 spaces] - What to use as tab when formatting the updated SystemJS configuration.
     */
    constructor(options = {}) {
        this._options = _.merge({}, defaultOptions, options);
        this._builder = this._instantiateBuilder();
        this._systemConfig = this._loadSystemConfig();
        this._systemConfig.bundles = {};
    }

    _buildTree(tree) {
        return this._builder
            .bundle(tree, {
                sourceMaps: this._options.sourceMaps,
                minify: this._options.minify
            })
            .catch(error => this._handleError(error));
    }

    /**
     * Bundle a specific application component.
     *
     * @param {String} index - Path to the index.js file of the component.
     * @returns {Promise}
     */
    bundleComponent(index) {
        const root = this._normalizePath(path.dirname(index));

        return this._builder
            .trace(index)
            .then(tree => this._filterVendorImports(tree))
            .then(tree => this._filterSubpackages(root, tree))
            .then(tree => this._filterPlugins(tree))
            .then(tree => this._buildTree(tree))
            .then(bundle => this._saveBundle(root, bundle))
            .catch(error => this._handleError(error));
    }

    /**
     * Bundles all application components.
     *
     * @returns {Promise}
     */
    bundleComponents() {
        const indexFiles = glob.sync(path.join(this._options.basePath, '**', 'index.js'));

        return Promise
            .map(indexFiles, index => this._normalizePath(path.relative(this._options.basePath, index)))
            .map(index => this.bundleComponent(index))
            .catch(error => this._handleError(error));
    }

    /**
     * Bundle a certain vendor package.
     *
     * @param {String} packageName - Package name, same as in the SystemJS configuration.
     * @returns {Promise}
     */
    bundleDependency(packageName) {
        return this.bundleDependencies([packageName], packageName);
    }

    /**
     * Combine multiple vendor packages into one bundle.
     *
     * @param {Array} packageNames - Which packages to bundle.
     * @param {String} saveAs - Name of the resulting bundle (without .js extension).
     * @returns {Promise}
     */
    bundleDependencies(packageNames, saveAs) {
        const traceExpression = packageNames.join(' + ');
        const dest = saveAs ? saveAs : packageNames.join('+');

        return this._builder
            .trace(traceExpression)
            .then(tree => this._filterVendors(tree, packageNames))
            .then(tree => this._filterAlreadyBundled(tree))
            .then(tree => this._buildTree(tree))
            .then(tree => this._saveBundle(dest, tree))
            .catch(error => this._handleError(error));
    }

    /**
     * Bundles all vendor packages which are not yet part of an existing bundle.
     *
     * @returns {Promise}
     */
    bundlePackageDependencies() {
        const packageDefinition = JSON.parse(fs.readFileSync('package.json').toString());
        let dependencies = Object.keys(packageDefinition.jspm.dependencies);

        return Promise
            .map(dependencies, packageName => this.bundleDependency(packageName))
            .catch(error => this._handleError(error));
    }

    _filterAlreadyBundled(tree) {
        return _.omit(tree, dependency => {
            return Object.keys(this._systemConfig.bundles).some(bundleName => {
                return this._systemConfig.bundles[bundleName].indexOf(dependency.name) !== -1;
            });
        });
    }

    _filterPlugins(tree) {
        if(this._systemConfig.buildCSS) {
            return tree;
        }

        return _.omit(tree, dependency => {
            return (
                dependency.name.indexOf('!') > -1 &&
                dependency.name.indexOf('!') < dependency.name.indexOf('plugin-css@')
            );
        });
    }

    _filterSubpackages(root, tree) {
        return _.omit(tree, dependency => {
            return (
                this._isInSubpackageWithin(dependency.name, root) ||
                this._isInPackageOutside(dependency.name, root)
            );
        });
    }

    _filterVendorImports(tree) {
        return _.pick(tree, dependency => this._stripPlugins(dependency.name).indexOf(':') === -1);
    }

    _filterVendors(tree, keepers) {
        const keeperMappings = keepers.map(packageName => this._systemConfig.map[packageName]);

        return _.pick(tree, dependency => {
            return keeperMappings.some(mapping => dependency.name.indexOf(mapping) === 0);
        });
    }

    _handleError(error) {
        throw error;
    }

    _instantiateBuilder() {
        let config = this._loadSystemConfig();
        config.bundles = {};
        config.baseURL = this._options.baseUrl;

        const fileProtocol = process.platform === 'win32' ? 'file:///' : 'file://';
        Object.keys(config.paths).forEach(key => {
            if(config.paths[key].indexOf('file:') !== 0) {
                config.paths[key] = fileProtocol + this._normalizePath(path.resolve(config.baseURL, config.paths[key]));
            }
        });

        return new Builder(config);
    }

    _isInPackageOutside(child, parent) {
        if(child.indexOf(parent) !== 0) {
            child = this._stripPlugins(child);

            while(child.indexOf('/') > -1) {
                child = this._navigateUp(child);

                if(fs.existsSync(path.join(this._options.basePath, child, 'index.js'))) {
                    return true;
                }
            }
        }

        return false;
    }

    _isInSubpackageWithin(child, parent) {
        if(child.indexOf(parent) === 0) {
            child = this._navigateUp(this._stripPlugins(child));

            while(child.length > parent.length) {
                if(fs.existsSync(path.join(this._options.basePath, child, 'index.js'))) {
                    return true;
                }

                child = this._navigateUp(child);
            }
        }

        return false;
    }

    _loadSystemConfig() {
        let System = SystemMock.getInstance();

        eval(fs.readFileSync(this._options.systemJsConfig).toString());

        return System.appliedConfig;
    }

    /**
     * Navigates on folder up in the given import path.
     *
     * @param {String} path
     * @returns {String}
     * @private
     */
    _navigateUp(path) {
        return path.slice(0, path.lastIndexOf('/'));
    }

    _normalizePath(value) {
        return value.replace(/\\/g, '/');
    }

    /**
     * Writes the bundle contents to disk and adds an entry for it to the SystemJS configuration.
     *
     * @param {String} root - Root (index.js) of the component.
     * @param {Object} bundle - Bundle object generated by SystemJS Builder.
     * @returns {Promise}
     * @private
     */
    _saveBundle(root, bundle) {
        if(!bundle.modules.length) {
            return Promise.resolve(null);
        }

        const dirname = path.join(this._options.dest, path.dirname(root));

        let filename;
        if(root !== '.') {
            filename = path.basename(root) + '.js';
        } else {
            root = 'index';
            filename = 'index.js';
        }

        const dest = path.join(dirname, filename);
        let source = bundle.source;

        return fs
            .ensureDirAsync(path.dirname(dest))
            .then(() => {
                if(this._options.sourceMaps) {
                    let sourceMap = filename + '.map';
                    source += '\n\n//# sourceMappingURL=' + sourceMap;

                    return fs.writeFileAsync(path.join(dirname, sourceMap), bundle.sourceMap)
                }
            })
            .then(() => {
                return fs.writeFileAsync(dest, source);
            })
            .then(() => {
                this._systemConfig.bundles[`${this._options.bundlesBaseUrl}/${root}`] = bundle.modules
            })
    }

    /**
     * Saves bundle information to the SystemJS configuration.
     *
     * @returns {Promise}
     */
    saveConfig() {
        let config = JSON
            .stringify(this._systemConfig, null, 2)
            .replace(new RegExp(`^${this._options.tab}"(meta|depCache|map|packages|bundles)"`, 'mg'), `${'\n'}${this._options.tab}$1`)
            .replace(new RegExp(`^${this._options.tab}"(\\w+)"`, 'mg'), this._options.tab + '$1');

        return fs.writeFileAsync(
            this._options.systemJsConfig,
            `System.config(${config});${'\n'}`
        );
    }

    /**
     * Removes plugin statements from an import path.
     *
     * @param {String} path
     * @returns {String}
     * @private
     */
    _stripPlugins(path) {
        var pluginIndex = path.indexOf('!');

        if(pluginIndex > -1) {
            return path.slice(0, pluginIndex);
        }

        return path;
    }
}

export default Bundler;
