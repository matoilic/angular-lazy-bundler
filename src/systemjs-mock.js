import _ from 'lodash';

const SystemMock = {
    config: function(config) {
        _.forOwn(config, function(value, key) {
            if(_.isObject(value)) {
                this.appliedConfig[key] = this.appliedConfig[key] || {};

                _.forOwn(value, function(subValue, subKey) {
                    this.appliedConfig[key][subKey] = value[subKey];
                }, this);
            } else {
                this.appliedConfig[key] = value;
            }
        }, this);
    }
};

export default {
    getInstance() {
        return _.merge({}, { appliedConfig: {} }, SystemMock);
    }
};
