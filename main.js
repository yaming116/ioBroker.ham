/* jshint -W097 */
/* jshint -W030 */
/* jshint strict: false */
/* jslint node: true */
/* jslint esversion: 6 */
'use strict';
const nodeFS  = require('fs');
const child_process = require('child_process');
// you have to require the utils module and call adapter function
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const path    = require('path');

// it is not an object.
function createHam(options) {
    const dataDir = path.normalize(path.join(utils.controllerDir, require(path.join(utils.controllerDir, 'lib', 'tools.js')).getDefaultDataDir()));

    // you have to call the adapter function and pass a options object
    // name has to be set and has to be equal to adapters folder name and main file name excluding extension
    // adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
    const adapter = new utils.Adapter(options);

    let homebridgeHandler;
    const attempts = {};

    // is called when adapter shuts down - callback has to be called under any circumstances!
    adapter.on('unload', callback => {
        try {
            adapter.log.info('cleaned everything up...');
            homebridgeHandler.end();
            callback();
        } catch (e) {
            callback();
        }
    });

    process.on('SIGINT', () => homebridgeHandler.end());

    process.on('SIGTERM', () => homebridgeHandler.end());

    process.on('uncaughtException', err => {
        if (adapter && adapter.log) {
            adapter.log.warn('Exception: ' + err);
        }
        homebridgeHandler.end();
    });

    // is called if a subscribed state changes
    adapter.on('stateChange', (id, state) => {
        // Warning, state can be null if it was deleted
        adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

        id = id.substr(adapter.namespace.length+1);
        adapter.log.debug('lookup id: ' + id);
        // you can use the ack flag to detect if it is status (true) or command (false)
        if (state && !state.ack) {
            adapter.log.debug('ack is not set!');
            homebridgeHandler.setValueForCharId(id, state.val);
        }
    });

    function updateDev(dev_id, dev_name, dev_type, dev_uuid) {
        adapter.log.info('updateDev ' + dev_id + ': name = ' + dev_name + ' /type= ' + dev_type);
        // create dev
        adapter.getObject(dev_id, (err, obj) => {
            if (!err && obj) {
                adapter.extendObject(dev_id, {
                    type: 'device',
                    common: {name: dev_name},
                    native: {
                        UUID: dev_uuid,
                        displayName: dev_name,
                        category: dev_type
                    }
                });
            }
            else {
                adapter.setObject(dev_id, {
                    type: 'device',
                    common: {name: dev_name},
                    native: {
                        UUID: dev_uuid,
                        displayName: dev_name,
                        category: dev_type
                    }
                }, {});
            }
        });
    }

    function updateChannel(dev_id, ch_id, name, ch_uuid) {
        const id = dev_id + '.' + ch_id;
        // create channel for dev
        adapter.log.info('updateChannel ' + id + ': name = ' + name);
        adapter.getObject(id, (err, obj) => {
            if (!err && obj) {
                adapter.extendObject(id, {
                    type: 'channel',
                    common: {name: name},
                    native: {
                        UUID: ch_uuid,
                        displayName: name
                    }
                });
            }
            else {
                adapter.setObject(id, {
                    type: 'channel',
                    common: {name: name},
                    native: {
                        UUID: ch_uuid,
                        displayName: name
                    }
                }, {});
            }
        });
    }

    function updateState(dev_id, ch_id, st_id, name, value, common, st_uuid, callback) {
        const id = dev_id + '.' + ch_id + '.'+ st_id;
        if (!common) common = {};
        if (common.name === undefined) common.name = name;
        if (common.role === undefined) common.role = 'state';
        if (common.read === undefined && common.write === undefined) common.read = true;
        if (common.type === undefined) common.type = 'string';
        if (common.unit === undefined) common.unit = '';

        adapter.log.info('updateState ' + id + ': value = ' + value + ' /common= ' + JSON.stringify(common));

        adapter.getObject(id, (err, obj) => {
            if (!err && obj) {
                adapter.extendObject(id, {
                    type: 'state',
                    common: common,
                    native: {
                        UUID: st_uuid,
                        displayName: name
                    }
                }, callback);
            }
            else {
                adapter.setObject(id, {
                    type: 'state',
                    common: common,
                    native: {
                        UUID: st_uuid,
                        displayName: name
                    }
                }, callback);
            }
        });
    }

    function setState(dev_id, ch_id, st_id, value) {
        const id = dev_id + '.' + ch_id + '.' + st_id;
        adapter.setState(id, value, true);
    }

    // is called when databases are connected and adapter received configuration.
    // start here!
    adapter.on('ready', main);

    function loadExistingAccessories(callback) {
        adapter.getDevices((err, res) => {
            if (err) {
                adapter.log.error('Can not get all existing devices: ' + err);
                return;
            }
            for (let i = 0; i < res.length; i++) {
                if (res[i].native && res[i].native.UUID) {
                    adapter.log.debug('Remember existing Accessory ' + res[i].native.displayName + ' with UUID ' + res[i].native.UUID);
                    homebridgeHandler.registerExistingAccessory(res[i].native.UUID, res[i].native.displayName);
                }
            }

            if (callback) callback();
        });
    }

    //Catch Homebridge Console Logging
    if (process.argv.indexOf('--logs') === -1 && process.argv.indexOf('-l') === -1) {
        console.log = function (logs) {
            if (adapter && adapter.log && adapter.log.debug) {
                adapter.log.debug(logs);
            }
            process.stdout.write(logs + '\n');
        };
    }

    function main() {
        const usedLogger = {
            info: adapter.log.debug,
            warn: adapter.log.warn,
            debug: adapter.log.silly,
            silly: adapter.log.silly
        };
        if (adapter.config.useGlobalHomebridge) {
            if (adapter.config.enableEditorForGlobalHomebridge) {
                // use ham cache dir like: iobroker-data/ham_0/
                adapter.config.globalHomebridgeConfigPath = dataDir + adapter.namespace.replace('.', '_')
                try {
                    // some Plugins want to have config file
                    // copy form https://github.com/Apollon77/homebridge-plugin-wrapper
                    nodeFS.writeFileSync(adapter.config.globalHomebridgeConfigPath + path.sep + 'config.json', JSON.stringify(adapter.config.wrapperConfig));
                }
                catch (e) {
                    adapter.log.warn(' Error writing ' + adapter.config.globalHomebridgeConfigPath + path.sep + 'config.json - Some Plugins may need that.');
                }
            }
            homebridgeHandler = require('./lib/global-handler');
            homebridgeHandler.init({
                logger: usedLogger,
                homebridgeBasePath: adapter.config.globalHomebridgeBasePath,
                homebridgeConfigPath: adapter.config.globalHomebridgeConfigPath,
                updateDev: updateDev,
                updateChannel: updateChannel,
                updateState: updateState,
                setState: setState,
                ignoreInfoAccessoryServices: adapter.config.ignoreInfoAccessoryServices,
                characteristicPollingInterval: adapter.config.characteristicPollingInterval * 1000,
                insecureAccess: adapter.config.insecureAccess || false
            });
        }
        else {
            homebridgeHandler = require('./lib/wrapper-handler');
            homebridgeHandler.init({
                logger: usedLogger,
                homebridgeConfigPath: dataDir + adapter.namespace.replace('.', '_'),
                updateDev: updateDev,
                updateChannel: updateChannel,
                updateState: updateState,
                setState: setState,
                wrapperConfig: adapter.config.wrapperConfig,
                ignoreInfoAccessoryServices: adapter.config.ignoreInfoAccessoryServices,
                characteristicPollingInterval: adapter.config.characteristicPollingInterval * 1000,
                insecureAccess: adapter.config.insecureAccess || false
            });
        }

        // in this template all states changes inside the adapters namespace are subscribed
        adapter.subscribeStates('*');

        installLibraries(() => {
            loadExistingAccessories(() => {
                homebridgeHandler.start();

                options.exitAfter && setTimeout(() => adapter && adapter.stop(), 10000);
            });
        });
    }

    function installNpm(npmLib, callback) {
        const path = __dirname;
        if (typeof npmLib === 'function') {
            callback = npmLib;
            npmLib = undefined;
        }

        const cmd = 'npm install ' + npmLib + ' --production --prefix "' + path + '"';
        adapter.log.info(cmd + ' (System call)');
        // Install node modules as system call

        // System call used for update of js-controller itself,
        // because during installation npm packet will be deleted too, but some files must be loaded even during the install process.
        const child = child_process.exec(cmd);

        child.stdout.on('data', buf => adapter.log.info(buf.toString('utf8')));
        child.stderr.on('data', buf => adapter.log.error(buf.toString('utf8')));

        child.on('exit', (code /* , signal */) => {
            if (code) {
                adapter.log.error('Cannot install ' + npmLib + ': ' + code);
            }
            // command succeeded
            if (typeof callback === 'function') callback(npmLib);
        });
    }

    function installLibraries(callback) {
        let allInstalled = true;
        if (adapter.config && adapter.config.libraries && !adapter.config.useGlobalHomebridge) {
            const libraries = adapter.config.libraries.split(/[,;\s]+/);

            for (let lib = 0; lib < libraries.length; lib++) {
                if (libraries[lib] && libraries[lib].trim()) {
                    libraries[lib] = libraries[lib].trim();
                    if (!nodeFS.existsSync(__dirname + '/node_modules/' + libraries[lib] + '/package.json')) {

                        if (!attempts[libraries[lib]]) {
                            attempts[libraries[lib]] = 1;
                        } else {
                            attempts[libraries[lib]]++;
                        }
                        if (attempts[libraries[lib]] > 3) {
                            adapter.log.error('Cannot install npm packet: ' + libraries[lib]);
                            continue;
                        }

                        installNpm(libraries[lib], () => installLibraries(callback));
                        allInstalled = false;
                        break;
                    }
                }
            }
        }
        if (allInstalled) callback();
    }

    return adapter;
}

if (!module || !module.parent) {
    createHam('ham');
} else {
    module.exports = createHam;
}
