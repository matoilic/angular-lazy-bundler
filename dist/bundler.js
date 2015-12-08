'use strict';

exports.__esModule = true;

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var _systemjsBuilder = require('systemjs-builder');

var _systemjsBuilder2 = _interopRequireDefault(_systemjsBuilder);

var _systemjsMock = require('./systemjs-mock');

var _systemjsMock2 = _interopRequireDefault(_systemjsMock);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _glob = require('glob');

var _glob2 = _interopRequireDefault(_glob);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _bluebird = require('bluebird');

var _bluebird2 = _interopRequireDefault(_bluebird);

var _fsExtra = require('fs-extra');

var _fsExtra2 = _interopRequireDefault(_fsExtra);

_bluebird2['default'].promisifyAll(_fsExtra2['default']);

var defaultOptions = {
    source: 'src',
    baseUrl: '.',
    bundlesBaseUrl: 'bundles',
    dest: 'build/bundles',
    systemJsConfig: 'config/system.js',
    sourceMaps: true,
    minify: true,
    tab: '  '
};

var Bundler = (function () {
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
     * @param {String} [options.tab=4 spaces] - What to use as tab when formatting the updated SystemJS configuration.
     */

    function Bundler() {
        var options = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];

        _classCallCheck(this, Bundler);

        this._options = _lodash2['default'].merge({}, defaultOptions, options);
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

    Bundler.prototype._buildTree = function _buildTree(tree) {
        var _this = this;

        return this._builder.bundle(tree, {
            sourceMaps: this._options.sourceMaps,
            minify: this._options.minify
        })['catch'](function (error) {
            return _this._handleError(error);
        });
    };

    /**
     * Bundles components and 3rd-party packages.
     *
     * @param {Object} content - Bundle content.
     * @param {Array} [content.components] - Which components to bundle (without "components/" prefix and without "/index.js" sufix).
     * @param {Array} [content.packages] - Which packages to bundle.
     * @param {String} saveAs - Name of the resulting bundle (without .js extension).
     * @returns {Promise}
     */

    Bundler.prototype.bundle = function bundle(_ref, saveAs) {
        var _this2 = this;

        var _ref$components = _ref.components;
        var components = _ref$components === undefined ? [] : _ref$components;
        var _ref$packages = _ref.packages;
        var packages = _ref$packages === undefined ? [] : _ref$packages;

        var updateTree = function updateTree(component) {
            return function (tree) {
                component.tree = tree;

                return component;
            };
        };

        return _bluebird2['default'].map(components, function (name) {
            return 'components/' + name + '/index';
        }).map(function (componentIndex) {
            return _this2._builder.trace(componentIndex).then(updateTree({ root: _path2['default'].dirname(componentIndex) }));
        }).map(function (component) {
            return _this2._filterVendorImports(component.tree).then(updateTree(component));
        }).map(function (component) {
            return _this2._filterSubpackages(component.root, component.tree).then(updateTree(component));
        }).map(function (component) {
            return _this2._filterPlugins(component.tree);
        }).reduce(function (componentsTree, tree) {
            return _lodash2['default'].merge(componentsTree, tree);
        }, {}).then(function (componentsTree) {
            var traceExpression = packages.join(' + ');

            return _this2._builder.trace(traceExpression).then(function (tree) {
                return _this2._filterVendors(tree, packages);
            }).then(function (tree) {
                return _this2._filterAlreadyBundled(tree);
            }).then(function (packagesTree) {
                return _lodash2['default'].merge(componentsTree, packagesTree);
            });
        }).then(function (bundleTree) {
            return _this2._buildTree(bundleTree);
        }).then(function (bundle) {
            return _this2._saveBundle(saveAs, bundle);
        })['catch'](function (error) {
            return _this2._handleError(error);
        });
    };

    /**
     * Bundle a specific component.
     *
     * @param {String} index - Path to the index.js file of the component.
     * @returns {Promise}
     */

    Bundler.prototype.bundleComponent = function bundleComponent(index) {
        var _this3 = this;

        var root = this._normalizePath(_path2['default'].dirname(index));

        return this._builder.trace(index).then(function (tree) {
            return _this3._filterAlreadyBundled(tree);
        }).then(function (tree) {
            return _this3._filterVendorImports(tree);
        }).then(function (tree) {
            return _this3._filterSubpackages(root, tree);
        }).then(function (tree) {
            return _this3._filterPlugins(tree);
        }).then(function (tree) {
            return _this3._buildTree(tree);
        }).then(function (bundle) {
            return _this3._saveBundle(root, bundle);
        })['catch'](function (error) {
            return _this3._handleError(error);
        });
    };

    /**
     * Combine multiple components into one bundle.
     *
     * @param {Array} componentNames - Which components to bundle (without "components/" prefix and without "/index.js" sufix).
     * @param {String} saveAs - Name of the resulting bundle (without .js extension).
     * @returns {Promise}
     */

    Bundler.prototype.bundleComponents = function bundleComponents(componentNames, saveAs) {
        var _this4 = this;

        return _bluebird2['default'].map(componentNames, function (name) {
            return 'components/' + name + '/index';
        }).map(function (index) {
            return _this4._builder.trace(index);
        }).map(function (tree) {
            return _this4._filterVendorImports(tree);
        }).map(function (tree) {
            return _this4._filterSubpackages(tree);
        }).map(function (tree) {
            return _this4._filterPlugins(tree);
        }).reduce(function (bundleTree, tree) {
            return _lodash2['default'].merge(bundleTree, tree);
        }, {}).then(function (tree) {
            return _this4._buildTree(tree);
        }).then(function (bundle) {
            return _this4._saveBundle(saveAs, bundle);
        })['catch'](function (error) {
            return _this4._handleError(error);
        });
    };

    /**
     * Bundle a certain vendor package.
     *
     * @param {String} packageName - Package name, same as in the SystemJS configuration.
     * @returns {Promise}
     */

    Bundler.prototype.bundlePackage = function bundlePackage(packageName) {
        return this.bundlePackages([packageName], packageName);
    };

    /**
     * Combine multiple vendor packages into one bundle.
     *
     * @param {Array} packageNames - Which packages to bundle.
     * @param {String} saveAs - Name of the resulting bundle (without .js extension).
     * @returns {Promise}
     */

    Bundler.prototype.bundlePackages = function bundlePackages(packageNames, saveAs) {
        var _this5 = this;

        var traceExpression = packageNames.join(' + ');
        var dest = saveAs ? saveAs : packageNames.join('+');

        return this._builder.trace(traceExpression).then(function (tree) {
            return _this5._filterVendors(tree, packageNames);
        }).then(function (tree) {
            return _this5._filterAlreadyBundled(tree);
        }).then(function (tree) {
            return _this5._buildTree(tree);
        }).then(function (tree) {
            return _this5._saveBundle(dest, tree);
        })['catch'](function (error) {
            return _this5._handleError(error);
        });
    };

    /**
     * Bundles all components which are not yet part of an existing bundle.
     *
     * @returns {Promise}
     */

    Bundler.prototype.bundleRemainingComponents = function bundleRemainingComponents() {
        var _this6 = this;

        var indexFiles = _glob2['default'].sync(_path2['default'].join(this._options.source, '**', 'index.js'));

        return _bluebird2['default'].map(indexFiles, function (index) {
            return _this6._normalizePath(_path2['default'].relative(_this6._options.source, index)).slice(0, -3);
        }).map(function (index) {
            return _this6.bundleComponent(index);
        })['catch'](function (error) {
            return _this6._handleError(error);
        });
    };

    /**
     * Bundles all vendor packages which are not yet part of an existing bundle.
     *
     * @returns {Promise}
     */

    Bundler.prototype.bundleRemainingPackages = function bundleRemainingPackages() {
        var _this7 = this;

        var packageDefinition = JSON.parse(_fsExtra2['default'].readFileSync('package.json').toString());
        var dependencies = Object.keys(packageDefinition.jspm.dependencies);

        return _bluebird2['default'].map(dependencies, function (packageName) {
            return _this7.bundlePackage(packageName);
        })['catch'](function (error) {
            return _this7._handleError(error);
        });
    };

    /**
     * Removes all entries from the tree which are already part of a bundle.
     *
     * @param {Object} tree
     * @return {Object}
     * @private
     */

    Bundler.prototype._filterAlreadyBundled = function _filterAlreadyBundled(tree) {
        var _this8 = this;

        return _bluebird2['default'].resolve(_lodash2['default'].omit(tree, function (dependency) {
            return Object.keys(_this8._systemConfig.bundles).some(function (bundleName) {
                return _this8._systemConfig.bundles[bundleName].indexOf(dependency.name) !== -1;
            });
        }));
    };

    /**
     * Removes all resources from the tree which are loaded using unsupported plugins.
     *
     * @param {Object} tree
     * @returns {Object}
     * @private
     */

    Bundler.prototype._filterPlugins = function _filterPlugins(tree) {
        if (this._systemConfig.buildCSS) {
            return tree;
        }

        return _bluebird2['default'].resolve(_lodash2['default'].omit(tree, function (dependency) {
            return dependency.name.indexOf('!') > -1 && dependency.name.indexOf('!') < dependency.name.indexOf('plugin-css@');
        }));
    };

    /**
     * Removes all resources which are part of a subpackage within the given package root.
     *
     * @param {String} root - e.g. components/my-component
     * @param {Object} tree
     * @returns {Object}
     * @private
     */

    Bundler.prototype._filterSubpackages = function _filterSubpackages(root, tree) {
        var _this9 = this;

        return _bluebird2['default'].resolve(_lodash2['default'].omit(tree, function (dependency) {
            return _this9._isInSubpackageWithin(dependency.name, root) || _this9._isInPackageOutside(dependency.name, root);
        }));
    };

    /**
     * Removes references to 3rd-party libraries from the tree, e.g. npm:angular.
     *
     * @param {Object} tree
     * @returns {Object}
     * @private
     */

    Bundler.prototype._filterVendorImports = function _filterVendorImports(tree) {
        var _this10 = this;

        return _bluebird2['default'].resolve(_lodash2['default'].pick(tree, function (dependency) {
            return _this10._stripPlugins(dependency.name).indexOf(':') === -1;
        }));
    };

    /**
     * Removes references to 3rd-party libraries except to the ones given in keepers.
     *
     * @param {Object} tree
     * @param {Array} keepers
     * @returns {Object}
     * @private
     */

    Bundler.prototype._filterVendors = function _filterVendors(tree, keepers) {
        var _this11 = this;

        var keeperMappings = keepers.map(function (packageName) {
            return _this11._systemConfig.map[packageName];
        });

        return _bluebird2['default'].resolve(_lodash2['default'].pick(tree, function (dependency) {
            return keeperMappings.some(function (mapping) {
                return dependency.name.indexOf(mapping) === 0;
            });
        }));
    };

    /**
     * Helper function to handle errors.
     *
     * @param {Object|String} error
     * @private
     */

    Bundler.prototype._handleError = function _handleError(error) {
        throw error;
    };

    /**
     * Factory function for SystemJS Builder.
     *
     * @private
     */

    Bundler.prototype._instantiateBuilder = function _instantiateBuilder() {
        var _this12 = this;

        var config = this._loadSystemConfig();
        config.bundles = {};
        config.baseURL = this._options.baseUrl;

        var fileProtocol = process.platform === 'win32' ? 'file:///' : 'file://';
        Object.keys(config.paths).forEach(function (key) {
            if (config.paths[key].indexOf('file:') !== 0) {
                config.paths[key] = fileProtocol + _this12._normalizePath(_path2['default'].resolve(config.baseURL, config.paths[key]));
            }
        });

        return new _systemjsBuilder2['default'](config);
    };

    /**
     * Checks if the given child resource is part of another package which is not a subpackage of parent.
     *
     * @param {String} child
     * @param {String} parent
     * @returns {boolean}
     * @private
     */

    Bundler.prototype._isInPackageOutside = function _isInPackageOutside(child, parent) {
        if (child.indexOf(parent) !== 0) {
            child = this._stripPlugins(child);

            while (child.indexOf('/') > -1) {
                child = this._navigateUp(child);

                if (_fsExtra2['default'].existsSync(_path2['default'].join(this._options.source, child, 'index.js'))) {
                    return true;
                }
            }
        }

        return false;
    };

    /**
     * Checks if the given child resource is part of another package which is a subpackage of parent.
     *
     * @param {String} child
     * @param {String} parent
     * @returns {boolean}
     * @private
     */

    Bundler.prototype._isInSubpackageWithin = function _isInSubpackageWithin(child, parent) {
        if (child.indexOf(parent) === 0) {
            child = this._navigateUp(this._stripPlugins(child));

            while (child.length > parent.length) {
                if (_fsExtra2['default'].existsSync(_path2['default'].join(this._options.source, child, 'index.js'))) {
                    return true;
                }

                child = this._navigateUp(child);
            }
        }

        return false;
    };

    /**
     * Reads the SystemJS configuration.
     *
     * @returns {Object}
     * @private
     */

    Bundler.prototype._loadSystemConfig = function _loadSystemConfig() {
        var System = _systemjsMock2['default'].getInstance();

        eval(_fsExtra2['default'].readFileSync(this._options.systemJsConfig).toString());

        return System.appliedConfig;
    };

    /**
     * Navigates on folder up in the given import path.
     *
     * @param {String} path
     * @returns {String}
     * @private
     */

    Bundler.prototype._navigateUp = function _navigateUp(path) {
        return path.slice(0, path.lastIndexOf('/'));
    };

    /**
     * Normalize paths across platforms to use forward slashes.
     *
     * @param {String} value
     * @returns {String}
     * @private
     */

    Bundler.prototype._normalizePath = function _normalizePath(value) {
        return value.replace(/\\/g, '/');
    };

    /**
     * Writes the bundle contents to disk and adds an entry for it to the SystemJS configuration.
     *
     * @param {String} root - Root (index.js) of the component.
     * @param {Object} bundle - Bundle object generated by SystemJS Builder.
     * @returns {Promise}
     * @private
     */

    Bundler.prototype._saveBundle = function _saveBundle(root, bundle) {
        var _this13 = this;

        if (!bundle.modules.length) {
            return _bluebird2['default'].resolve(null);
        }

        var dirname = _path2['default'].join(this._options.dest, _path2['default'].dirname(root));

        var filename = undefined;
        if (root !== '.') {
            filename = _path2['default'].basename(root) + '.js';
        } else {
            root = 'index';
            filename = 'index.js';
        }

        var dest = _path2['default'].join(dirname, filename);
        var source = bundle.source;

        return _fsExtra2['default'].ensureDirAsync(_path2['default'].dirname(dest)).then(function () {
            if (_this13._options.sourceMaps) {
                var sourceMap = filename + '.map';
                source += '\n\n//# sourceMappingURL=' + sourceMap;

                return _fsExtra2['default'].writeFileAsync(_path2['default'].join(dirname, sourceMap), bundle.sourceMap);
            }
        }).then(function () {
            return _fsExtra2['default'].writeFileAsync(dest, source);
        }).then(function () {
            _this13._systemConfig.bundles[_this13._options.bundlesBaseUrl + '/' + root] = bundle.modules;
        });
    };

    /**
     * Saves bundle information to the SystemJS configuration.
     *
     * @returns {Promise}
     */

    Bundler.prototype.saveConfig = function saveConfig() {
        var config = JSON.stringify(this._systemConfig, null, 2).replace(new RegExp('^' + this._options.tab + '"(meta|depCache|map|packages|bundles)"', 'mg'), '\n' + this._options.tab + '$1').replace(new RegExp('^' + this._options.tab + '"(\\w+)"', 'mg'), this._options.tab + '$1');

        return _fsExtra2['default'].writeFileAsync(this._options.systemJsConfig, 'System.config(' + config + ');' + '\n');
    };

    /**
     * Removes plugin statements from an import path.
     *
     * @param {String} path
     * @returns {String}
     * @private
     */

    Bundler.prototype._stripPlugins = function _stripPlugins(path) {
        var pluginIndex = path.indexOf('!');

        if (pluginIndex > -1) {
            return path.slice(0, pluginIndex);
        }

        return path;
    };

    return Bundler;
})();

exports['default'] = Bundler;
module.exports = exports['default'];