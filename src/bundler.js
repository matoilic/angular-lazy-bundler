import Builder from 'systemjs-builder';
import SystemMock from './systemjs-mock';
import _ from 'lodash';
import glob from 'glob';
import path from 'path';
import Promise from 'bluebird';
import fs from 'fs-extra';

Promise.promisifyAll(fs);

const defaultOptions = {
    source: 'src',
    baseUrl: '.',
    bundlesBaseUrl: 'bundles',
    dest: 'build/bundles',
    systemJsConfig: 'config/system.js',
    sourceMaps: true,
    minify: true,
    cssOptimize: false,
    tab: '  '
};

class Bundler {
    /**
     *
     * @param {Object} options - Bundler options.
     * @param {String} [options.source=src] - Where to search for components / index.js files.
     * @param {String} [options.baseUrl=.] - Base URL on the file system to use for bundling.
     * @param {String} [options.dest=build/bundles] - Destination folder where the bundled resources will be written to.
     * @param {String} [options.bundlesBaseUrl=bundles] - Path relative to the baseURL of SystemJS in the browser of the destination folder.
     * @param {String} [options.systemJsConfig=config/system.js] - Path to the SystemJS configuration file.
     * @param {Boolean} [options.sourceMaps=true] - Enable / disable sourcemap generation.
     * @param {Boolean} [options.minify=true] - Enable / disable minification of bundled resources.
     * @param {Boolean} [options.cssOptimize=false] - Enable / disable CSS optimization through SystemJS' CSS plugin. The plugin uses `clean-css` in the background.
     * @param {String} [options.tab=4 spaces] - What to use as tab when formatting the updated SystemJS configuration.
     */
    constructor(options = {}) {
        this._options = _.merge({}, defaultOptions, options);
        this._builder = this._instantiateBuilder();
        this._systemConfig = this._loadSystemConfig();
        this._systemConfig.bundles = {};
    }

    /**
     * Bundles all resources in the given dependency tree.
     *
     * @param {Object} tree - The dependency tree to build.
     * @returns {Promise}
     * @private
     */
    _buildTree(tree) {
        return this._builder
            .bundle(tree, {
                sourceMaps: this._options.sourceMaps,
                minify: this._options.minify,
                cssOptimize: this._options.cssOptimize
            })
            .catch(error => this._handleError(error));
    }

    /**
     * Bundles components and 3rd-party packages.
     *
     * @param {Object} content - Bundle content.
     * @param {Array} [content.components] - Which components to bundle (without "components/" prefix and without "/index.js" sufix).
     * @param {Array} [content.packages] - Which packages to bundle.
     * @param {String} saveAs - Name of the resulting bundle (without .js extension).
     * @returns {Promise}
     */
    bundle({components: components = [], packages: packages = []}, saveAs) {
        const updateTree = (component) => {
            return function(tree) {
                component.tree = tree;

                return component;
            };
        };

        return this._traceComponents(components)
            .then(componentsTree => {
                return this
                    ._tracePackages(packages)
                    .then(packagesTree => _.merge(componentsTree, packagesTree))
            })
            .then(bundleTree => this._buildTree(bundleTree))
            .then(bundle => this._saveBundle(saveAs, bundle))
            .catch(error => this._handleError(error));
    }

    /**
     * Bundle a specific component.
     *
     * @param {String} index - Path to the index.js file of the component.
     * @returns {Promise}
     */
    bundleComponent(index) {
        const root = this._normalizePath(path.dirname(index));

        return this._builder
            .trace(index)
            .then(tree => this._filterAlreadyBundled(tree))
            .then(tree => this._filterVendorImports(tree))
            .then(tree => this._filterSubpackages(root, tree))
            .then(tree => this._filterPlugins(tree))
            .then(tree => this._buildTree(tree))
            .then(bundle => this._saveBundle(root, bundle))
            .catch(error => this._handleError(error));
    }

    /**
     * Combine multiple components into one bundle.
     *
     * @param {Array} componentNames - Which components to bundle (without "components/" prefix and without "/index.js" sufix).
     * @param {String} saveAs - Name of the resulting bundle (without .js extension).
     * @returns {Promise}
     */
    bundleComponents(componentNames, saveAs) {
        return this._traceComponents(componentNames)
            .then(tree => this._buildTree(tree))
            .then(bundle => this._saveBundle(saveAs, bundle))
            .catch(error => this._handleError(error));
    }

    /**
     * Bundle a certain vendor package.
     *
     * @param {String} packageName - Package name, same as in the SystemJS configuration.
     * @returns {Promise}
     */
    bundlePackage(packageName) {
        return this.bundlePackages([packageName], packageName);
    }

    /**
     * Combine multiple vendor packages into one bundle.
     *
     * @param {Array} packageNames - Which packages to bundle.
     * @param {String} saveAs - Name of the resulting bundle (without .js extension).
     * @returns {Promise}
     */
    bundlePackages(packageNames, saveAs) {
        return this
            ._tracePackages(packageNames)
            .then(tree => this._buildTree(tree))
            .then(tree => this._saveBundle(saveAs, tree))
            .catch(error => this._handleError(error));
    }

    /**
     * Bundles all components which are not yet part of an existing bundle.
     *
     * @returns {Promise}
     */
    bundleRemainingComponents() {
        const indexFiles = glob.sync(path.join(this._options.baseUrl, this._options.source, 'components', '**', 'index.js'));

        return Promise
            .map(indexFiles, index => this._normalizePath(path.relative(this._options.baseUrl, index)).slice(0, -3))
            .map(index => this.bundleComponent(index))
            .catch(error => this._handleError(error));
    }

    /**
     * Bundles all vendor packages which are not yet part of an existing bundle.
     *
     * @returns {Promise}
     */
    bundleRemainingPackages() {
        const packageDefinition = JSON.parse(fs.readFileSync('package.json').toString());
        const dependencies = Object
            .keys(packageDefinition.jspm.dependencies)
            // only package those with a "main" definition
            .filter(packageName => {
                const absolutePath = this._builder.loader.normalizeSync(packageName).slice(7);

                return fs.existsSync(absolutePath);
            });

        return Promise
            .map(dependencies, packageName => this.bundlePackage(packageName))
            .catch(error => this._handleError(error));
    }

    /**
     * Removes all entries from the tree which are already part of a bundle.
     *
     * @param {Object} tree
     * @return {Object}
     * @private
     */
    _filterAlreadyBundled(tree) {
        return Promise.resolve(_.omit(tree, dependency => {
            return Object.keys(this._systemConfig.bundles).some(bundleName => {
                return this._systemConfig.bundles[bundleName].indexOf(dependency.name) !== -1;
            });
        }));
    }

    /**
     * Removes all resources from the tree which are loaded using unsupported plugins.
     *
     * @param {Object} tree
     * @returns {Object}
     * @private
     */
    _filterPlugins(tree) {
        if(this._systemConfig.buildCSS) {
            return tree;
        }

        return Promise.resolve(_.omit(tree, dependency => {
            return (
                dependency.name.indexOf('!') > -1 &&
                dependency.name.indexOf('!') < dependency.name.indexOf('plugin-css@')
            );
        }));
    }

    /**
     * Removes all resources which are part of a subpackage within the given package root.
     *
     * @param {String} root - e.g. components/my-component
     * @param {Object} tree
     * @returns {Object}
     * @private
     */
    _filterSubpackages(root, tree) {
        return Promise.resolve(_.omit(tree, dependency => {
            return (
                this._isInSubpackageWithin(dependency.name, root) ||
                this._isInPackageOutside(dependency.name, root)
            );
        }));
    }

    /**
     * Removes references to 3rd-party libraries from the tree, e.g. npm:angular.
     *
     * @param {Object} tree
     * @returns {Object}
     * @private
     */
    _filterVendorImports(tree) {
        return Promise.resolve(_.pick(tree, dependency => this._stripPlugins(dependency.name).indexOf(':') === -1));
    }

    /**
     * Removes references to 3rd-party libraries except to the ones given in keepers.
     *
     * @param {Object} tree
     * @param {Array} keepers
     * @returns {Object}
     * @private
     */
    _filterVendors(tree, keepers) {
        const keeperMappings = new Set(keepers.map(packageName => {
            const containingPackage = packageName.split('/').shift();

            return this._systemConfig.map[containingPackage] || this._systemConfig.paths[containingPackage];
        }));


        // also resolve sub dependencies of the libraries to keep
        let before = 0;
        let after = 1;
        while(before !== after) {
            before = keeperMappings.length;

            keeperMappings.forEach((key) => {
                const subMapping = this._systemConfig.map[key];

                if(typeof subMapping === 'object') {
                    Object.keys(subMapping).forEach((k) => keeperMappings.add(subMapping[k]));
                }
            });

            after = keeperMappings.length;
        }

        return Promise.resolve(_.pick(tree, dependency => {
            for(let mapping of keeperMappings) {
                if(dependency.name.indexOf(mapping) === 0) {
                    return true;
                }
            }

            return false;
        }));
    }

    /**
     * Helper function to handle errors.
     *
     * @param {Object|String} error
     * @private
     */
    _handleError(error) {
        throw error;
    }

    /**
     * Factory function for SystemJS Builder.
     *
     * @private
     */
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

    /**
     * Checks if the given child resource is part of another package which is not a subpackage of parent.
     *
     * @param {String} child
     * @param {String} parent
     * @returns {boolean}
     * @private
     */
    _isInPackageOutside(child, parent) {
        if(child.indexOf(parent) !== 0) {
            child = this._stripPlugins(child);

            while(child.indexOf('/') > -1) {
                child = this._navigateUp(child);

                if(fs.existsSync(path.join(this._options.source, child, 'index.js'))) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Checks if the given child resource is part of another package which is a subpackage of parent.
     *
     * @param {String} child
     * @param {String} parent
     * @returns {boolean}
     * @private
     */
    _isInSubpackageWithin(child, parent) {
        if(child.indexOf(parent) === 0) {
            child = this._navigateUp(this._stripPlugins(child));

            while(child.length > parent.length) {
                if(fs.existsSync(path.join(this._options.baseUrl, child, 'index.js'))) {
                    return true;
                }

                child = this._navigateUp(child);
            }
        }

        return false;
    }

    /**
     * Reads the SystemJS configuration.
     *
     * @returns {Object}
     * @private
     */
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

    /**
     * Normalize paths across platforms to use forward slashes.
     *
     * @param {String} value
     * @returns {String}
     * @private
     */
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
                    const sourceMapFileName = filename + '.map';
                    source += '\n\n//# sourceMappingURL=' + sourceMapFileName;

                    const sourceMap = JSON.parse(bundle.sourceMap);
                    sourceMap.sources = sourceMap.sources.map((src) => `../../${src}`);

                    return fs.writeFileAsync(path.join(dirname, sourceMapFileName), JSON.stringify(sourceMap));
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

    /**
     * Builds the dependency tree for the given components.
     *
     * @param {Array} components
     * @returns {Promise}
     * @private
     */
    _traceComponents(components) {
        if(!components.length) {
            return Promise.resolve({});
        }

        const updateTree = (component) => {
            return function(tree) {
                component.tree = tree;

                return component;
            };
        };

        return Promise
            .map(components, name => path.join(this._options.source, 'components', name, 'index'))
            .map(componentIndex => this._builder
                .trace(componentIndex)
                .then(updateTree({ root: path.dirname(componentIndex) }))
            )
            .map(component => this
                ._filterVendorImports(component.tree)
                .then(updateTree(component))
            )
            .map(component => this
                ._filterSubpackages(component.root, component.tree)
                .then(updateTree(component))
            )
            .map(component => this._filterPlugins(component.tree))
            .reduce((componentsTree, tree) => _.merge(componentsTree, tree), {})
    }

    /**
     * Builds the dependency tree for the given packages.
     *
     * @param {Array} packages
     * @returns {Promise}
     * @private
     */
    _tracePackages(packages) {
        if(!packages.length) {
            return Promise.resolve({});
        }

        const traceExpression = packages.join(' + ');

        return this._builder
            .trace(traceExpression)
            .then(tree => this._filterVendors(tree, packages))
            .then(tree => this._filterAlreadyBundled(tree));
    }
}

export default Bundler;
