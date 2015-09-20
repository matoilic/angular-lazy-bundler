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
    basePath: 'build',
    bundlesBaseUrl: 'bundles',
    dest: 'build/bundles',
    systemJsConfig: 'config/system.js',
    sourceMaps: true,
    minify: true,
    onError: function onError() {},
    tab: '  '
};

var Bundler = (function () {
    function Bundler() {
        var options = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];

        _classCallCheck(this, Bundler);

        this.options = _lodash2['default'].merge({}, defaultOptions, options);
        this._builder = this._instantiateBuilder();
        this._systemConfig = this._loadSystemConfig();
        this._systemConfig.bundles = {};
    }

    Bundler.prototype._buildTree = function _buildTree(tree) {
        var _this = this;

        return this._builder.bundle(tree, {
            sourceMaps: this.options.sourceMaps,
            minify: this.options.minify
        })['catch'](function (error) {
            return _this._handleError(error);
        });
    };

    Bundler.prototype.bundleComponent = function bundleComponent(index) {
        var _this2 = this;

        var root = _path2['default'].dirname(index);

        return this._builder.trace(index).then(function (tree) {
            return _this2._filterVendorImports(tree);
        }).then(function (tree) {
            return _this2._filterSubpackages(root, tree);
        }).then(function (tree) {
            return _this2._buildTree(tree);
        }).then(function (bundle) {
            return _this2._saveBundle(root, bundle);
        })['catch'](function (error) {
            return _this2._handleError(error);
        });
    };

    Bundler.prototype.bundleComponents = function bundleComponents() {
        var _this3 = this;

        var indexFiles = _glob2['default'].sync(_path2['default'].join(this.options.basePath, '**', 'index.js'));

        return _bluebird2['default'].map(indexFiles, function (index) {
            return _path2['default'].relative(_this3.options.basePath, index);
        }).map(function (index) {
            return _this3.bundleComponent(index);
        })['catch'](function (error) {
            return _this3._handleError(error);
        });
    };

    Bundler.prototype.bundleDependency = function bundleDependency(packageName) {
        return this.bundleDependencies([packageName], packageName);
    };

    Bundler.prototype.bundleDependencies = function bundleDependencies(packageNames, saveAs) {
        var _this4 = this;

        var traceExpression = packageNames.join(' + ');
        var dest = saveAs ? saveAs : packageNames.join('+');

        return this._builder.trace(traceExpression).then(function (tree) {
            return _this4._filterVendors(tree, packageNames);
        }).then(function (tree) {
            return _this4._buildTree(tree);
        }).then(function (tree) {
            return _this4._saveBundle(dest, tree);
        })['catch'](function (error) {
            return _this4._handleError(error);
        });
    };

    Bundler.prototype.bundlePackageDependencies = function bundlePackageDependencies() {
        var _this5 = this;

        var packageDefinition = JSON.parse(_fsExtra2['default'].readFileSync('package.json').toString());
        var dependencies = Object.keys(packageDefinition.jspm.dependencies);

        return _bluebird2['default'].map(dependencies, function (packageName) {
            return _this5.bundleDependency(packageName);
        })['catch'](function (error) {
            return _this5._handleError(error);
        });
    };

    Bundler.prototype._filterSubpackages = function _filterSubpackages(root, tree) {
        var _this6 = this;

        return _lodash2['default'].omit(tree, function (dependency) {
            return _this6._isInSubpackageWithin(dependency.name, root) || _this6._isInPackageOutside(dependency.name, root);
        });
    };

    Bundler.prototype._filterVendorImports = function _filterVendorImports(tree) {
        var _this7 = this;

        return _lodash2['default'].pick(tree, function (dependency) {
            return _this7._stripPlugins(dependency.name).indexOf(':') === -1;
        });
    };

    Bundler.prototype._filterVendors = function _filterVendors(tree, keepers) {
        var _this8 = this;

        var keeperMappings = keepers.map(function (packageName) {
            return _this8._systemConfig.map[packageName];
        });

        return _lodash2['default'].pick(tree, function (dependency) {
            return keeperMappings.some(function (mapping) {
                return dependency.name.indexOf(mapping) === 0;
            });
        });
    };

    Bundler.prototype._handleError = function _handleError(error) {
        this.options.onError.call(null, error);
    };

    Bundler.prototype._instantiateBuilder = function _instantiateBuilder() {
        var config = this._loadSystemConfig();
        config.bundles = {};
        config.baseURL = this.options.basePath;

        var fileProtocol = process.platform === 'win32' ? 'file:///' : 'file://';
        Object.keys(config.paths).forEach(function (key) {
            if (config.paths[key].indexOf('file:') !== 0) {
                config.paths[key] = fileProtocol + _path2['default'].resolve(config.baseURL, config.paths[key]);
            }
        });

        return new _systemjsBuilder2['default'](config);
    };

    Bundler.prototype._isInPackageOutside = function _isInPackageOutside(child, parent) {
        if (child.indexOf(parent) !== 0) {
            child = this._stripPlugins(child);

            while (child.indexOf('/') > -1) {
                child = this._navigateUp(child);

                if (_fsExtra2['default'].existsSync(_path2['default'].join(this.options.basePath, child, 'index.js'))) {
                    return true;
                }
            }
        }

        return false;
    };

    Bundler.prototype._isInSubpackageWithin = function _isInSubpackageWithin(child, parent) {
        if (child.indexOf(parent) === 0) {
            child = this._navigateUp(this._stripPlugins(child));

            while (child.length > parent.length) {
                if (_fsExtra2['default'].existsSync(_path2['default'].join(this.options.basePath, child, 'index.js'))) {
                    return true;
                }

                child = this._navigateUp(child);
            }
        }

        return false;
    };

    Bundler.prototype._loadSystemConfig = function _loadSystemConfig() {
        var System = _systemjsMock2['default'].getInstance();

        eval(_fsExtra2['default'].readFileSync(this.options.systemJsConfig).toString());

        return System.appliedConfig;
    };

    Bundler.prototype._navigateUp = function _navigateUp(path) {
        return path.slice(0, path.lastIndexOf('/'));
    };

    Bundler.prototype._saveBundle = function _saveBundle(root, bundle) {
        var _this9 = this;

        var dirname = _path2['default'].join(this.options.dest, _path2['default'].dirname(root));
        var filename = root !== '.' ? _path2['default'].basename(root) + '.js' : 'index.js';
        var dest = _path2['default'].join(dirname, filename);
        var source = bundle.source;

        return _fsExtra2['default'].ensureDirAsync(_path2['default'].dirname(dest)).then(function () {
            if (_this9.options.sourceMaps) {
                var sourceMap = filename + '.map';
                source += '\n\n//# sourceMappingURL=' + sourceMap;

                return _fsExtra2['default'].writeFileAsync(_path2['default'].join(dirname, sourceMap), bundle.sourceMap);
            }
        }).then(function () {
            return _fsExtra2['default'].writeFileAsync(dest, source);
        }).then(function () {
            _this9._systemConfig.bundles[_this9.options.bundlesBaseUrl + '/' + root] = bundle.modules;
        });
    };

    Bundler.prototype.saveConfig = function saveConfig() {
        var config = JSON.stringify(this._systemConfig, null, 2).replace(new RegExp('^' + this.options.tab + '"(meta|depCache|map|packages|bundles)"', 'mg'), '\n' + this.options.tab + '$1').replace(new RegExp('^' + this.options.tab + '"(\\w+)"', 'mg'), this.options.tab + '$1');

        return _fsExtra2['default'].writeFileAsync(this.options.systemJsConfig, 'System.config(' + config + ');' + '\n');
    };

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