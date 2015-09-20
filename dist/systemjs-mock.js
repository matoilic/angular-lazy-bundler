'use strict';

exports.__esModule = true;

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var SystemMock = {
    config: function config(_config) {
        _lodash2['default'].forOwn(_config, function (value, key) {
            if (_lodash2['default'].isObject(value)) {
                this.appliedConfig[key] = this.appliedConfig[key] || {};

                _lodash2['default'].forOwn(value, function (subValue, subKey) {
                    this.appliedConfig[key][subKey] = value[subKey];
                }, this);
            } else {
                this.appliedConfig[key] = value;
            }
        }, this);
    }
};

exports['default'] = {
    getInstance: function getInstance() {
        return _lodash2['default'].merge({}, { appliedConfig: {} }, SystemMock);
    }
};
module.exports = exports['default'];