# Angular Lazy Bundler



```javascript
const Bundler = require('angular-lazy-bundler');

const bundler = new Bundler({
    systemJsConfig: 'config/system.js'
});

bundler
    //bundles the sources of our application per component
    .bundleComponents()
    //creates a custom bundle with all packages required for boostrapping the application
    .then(() => {
        return bundler.bundleDependencies(
            [
                'angular',
                'angular-resource',
                'angular-sanitize',
                'angular-ui-router',
                'ui-router-extras'
            ],
            'main-vendors'
        );
    })
    //bundles the remaining packages individually
    .then(() => bundler.bundlePackageDependencies())
    //updates our SystemJS configuration
    .then(() => bundler.saveConfig())
    //here we can handle errors
    .catch((err) => { });
```