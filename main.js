// @ts-nocheck
'use strict';

/*
 * Created with @iobroker/create-adapter v1.11.0
 */

const utils = require('@iobroker/adapter-core');

const _ = require('lodash');
const {Telnet} = require('telnet-rxjs-ansgar');

const newLine = String.fromCharCode(13);
const START_SOP = 'start_sop';
const ENDE_SOP = 'ende_sop';
const START_SKD = 'start_skd';
const ENDE_SKD = 'ende_skd';
const START_SMO = 'start_smo';
const ENDE_SMO = 'ende_smo';
const START_SMC = 'start_smc';
const ENDE_SMC = 'ende_smc';
const START_SFI = 'start_sfi';
const ENDE_SFI = 'ende_sfi';
const START_SMN = 'start_smn';
const ENDE_SMN = 'ende_smn';
const ENDE_SMN_START_STI = 'ende_smn\r\nstart_sti';


let client = null;
let connected = false;
let connecting = false;
const commandCallbacks = [];
let runningCommandCallbacks = false;

let controllerChannelCount;
let controllerSoftwareVersion;

let readSop = false;
let readSkd = false;
let readSmo = false;
let readSmc = false;
let readSfi = false;
let readSmn = false;

const actualPercents = {};

let checkShutterStatusClearTimeoutHandler;
let sleepClearTimeoutHandler;

const memoizeDebounce = function (func, wait = 0, options = {}) {
    const mem = _.memoize(function () {
        return _.debounce(func, wait, options);
    }, options.resolver);
    return function () {
        mem.apply(this, arguments).apply(this, arguments);
    };
};

const calculateLuxValueBasedOnHeytech = function (wert) {
    let luxPrefix;
    let lux;

    if (wert < 10) {              // - LuxPrefix = 1 --> Lux-Wert n steht für   1 ... 900 Lux
        luxPrefix = 0;
        lux = wert;             //  ' - LuxPrefix = 0 --> Lux-Wert n steht für 0,1 ... 0,9 Lux
    } else if (wert <= 19) {     //  ' - LuxPrefix = 2 --> Lux-Wert n steht für   1 ... 900 kLux
        luxPrefix = 1;
        lux = wert - 9;
    } else if (wert <= 28) {
        luxPrefix = 1;
        lux = wert - 20;
        lux = lux * 10;
        lux = lux + 20;
    } else if (wert <= 36) {
        luxPrefix = 1;
        lux = wert - 29;
        lux = lux * 100;
        lux = lux + 200;
    } else if (wert <= 136) {
        luxPrefix = 2;
        lux = wert - 36;
    } else {
        luxPrefix = 2;
        lux = wert - 137;
        lux = lux * 10;
        lux = lux + 110;
    }

    let resultLux;
    if (luxPrefix === 0) {
        resultLux = 1 - (10 - lux) / 10;
    } else if (luxPrefix === 1) {
        resultLux = lux;
    } else { // LuxPrefix === 2
        resultLux = lux * 1000;
    }
    return resultLux;
};

const calculateLuxValueCustom = function (data) {
    let briV = 0;
    if (data < 19) {
        briV = data * 1;
    } else if (data > 19 && data < 29) {
        briV = data * 4;
    } else if (data > 29 && data < 39) {
        briV = data * 8;
    } else if (data > 39 && data < 49) {
        briV = data * 15;
    } else if (data > 49 && data < 59) {
        briV = data * 22;
    } else if (data > 59 && data < 69) {
        briV = data * 30;
    } else if (data > 69 && data < 79) {
        briV = data * 40;
    } else if (data > 79 && data < 89) {
        briV = data * 50;
    } else if (data > 89 && data < 99) {
        briV = data * 64;
    } else if (data > 99 && data < 109) {
        briV = data * 80;
    } else if (data > 109 && data < 119) {
        briV = data * 100;
    } else if (data > 119 && data < 129) {
        briV = data * 117;
    } else if (data > 129 && data < 139) {
        briV = data * 138;
    } else if (data > 139 && data < 149) {
        briV = data * 157;
    } else if (data > 149 && data < 159) {
        briV = data * 173;
    } else if (data > 159 && data < 169) {
        briV = data * 194;
    } else if (data > 169 && data < 179) {
        briV = data * 212;
    } else if (data > 179 && data < 189) {
        briV = data * 228;
    } else if (data > 189 && data < 199) {
        briV = data * 247;
    } else if (data > 199 && data < 209) {
        briV = data * 265;
    } else if (data > 209 && data < 219) {
        briV = data * 286;
    } else if (data > 219 && data < 229) {
        briV = data * 305;
    } else if (data > 229 && data < 239) {
        briV = data * 322;
    } else if (data > 239 && data < 249) {
        briV = data * 342;
    } else if (data > 249 && data < 259) {
        briV = data * 360;
    }
    return briV;
};

function createClient() {
    let lastStrings = '';

    // this.log.debug = console.log;
    // this.log.info = console.info;
    // this.log.error = console.error;

    if (this.config.ip === '' || this.config.ip === null || this.config.ip === undefined) {
        this.log.warn('No ip address in configuration found');
    } else if (this.config.port === '' || this.config.port === null || this.config.port === undefined) {
        this.log.warn('No port in configuration found');
    } else {

        client = Telnet.client(this.config.ip + ':' + this.config.port);
        setInterval(() => {
            this.sendeRefreshBefehl();
        }, this.config.refresh || 300000);

        client.filter((event) => event instanceof Telnet.Event.Connected)
            .subscribe(async () => {
                connected = true;
                connecting = false;
                const that = this;

                function firstRunDone() {
                    const result = readSop && readSkd && readSmo && readSmc && readSfi && readSmn;
                    that.log.debug('FIRST RUN DONE?: ' + (result));
                    if (!result) {
                        that.log.debug('readSop: ' + readSop);
                        that.log.debug('readSkd: ' + readSkd);
                        that.log.debug('readSmo: ' + readSmo);
                        that.log.debug('readSmc: ' + readSmc);
                        that.log.debug('readSfi: ' + readSfi);
                        that.log.debug('readSmn: ' + readSmn);
                    }
                    return result;
                }

                this.log.info('Connected to controller');


                if (this.config.pin !== '') {
                    client.send('rsc');
                    client.send(newLine);
                    client.send(this.config.pin.toString());
                    client.send(newLine);
                }
                while (!firstRunDone()) {
                    client.send(newLine);
                    client.send('sss');
                    client.send(newLine);
                    client.send('sss');
                    client.send(newLine);
                    if (!readSmo) {
                        client.send('smo');
                        client.send(newLine);
                    }
                    client.send('sdt');
                    client.send(newLine);
                    if (!readSmc) {
                        client.send('smc');
                        client.send(newLine);
                    }
                    if (!readSfi) {
                        client.send('sfi');
                        client.send(newLine);
                    }
                    if (!readSmn) {
                        client.send('smn');
                        client.send(newLine);
                    }
                    if (!readSkd) {
                        client.send('skd');
                        client.send(newLine);
                    }
                    await this.sleep(2000);
                }

                if (commandCallbacks.length > 0) {
                    await this.waitForRunningCommandCallbacks();
                    runningCommandCallbacks = true;
                    this.checkShutterStatus()();

                    let commandCallback;
                    do {
                        commandCallback = commandCallbacks.shift();
                        if (commandCallback) {
                            commandCallback();
                            await this.sleep(500);
                        }
                    } while (commandCallbacks.length > 0);
                    runningCommandCallbacks = false;
                }

            });

        client.filter((event) => event instanceof Telnet.Event.Disconnected)
            .subscribe(() => {
                this.log.info('Disconnected from controller');
                connected = false;
                connecting = false;
            });

        client.subscribe(
            () => {
                // console.log('Received event:', event);
            },
            (error) => {
                console.error('An error occurred:', error);
            }
        );

        let smn = '';

        client.data.subscribe((data) => {
            //this.log.debug('Data: ' + data);

            lastStrings = lastStrings.concat(data);
            // this.log.debug(lastStrings);
            if (!readSmn && lastStrings.indexOf(START_SMN) >= 0 || lastStrings.indexOf(ENDE_SMN) >= 0) {
                if (lastStrings.includes(ENDE_SMN_START_STI)) { //check end of smn data
                    smn = smn.concat(data); // erst hier concaten, weil ansonsten das if lastStrings.endsWith nicht mehr stimmt, weil die telnet Verbindung schon wieder was gesendet hat...
                    const channels = smn.match(/\d\d,.*,\d,/gm);
                    wOutputs(channels);
                    smn = '';
                    lastStrings = '';
                    this.log.debug('Shutters gelesen');
                    readSmn = true;
                } else {
                    smn = smn.concat(data);
                }
            } else if (lastStrings.indexOf(START_SOP) >= 0 && lastStrings.indexOf(ENDE_SOP) >= 0) {
                // SOP  Oeffnungs-Prozent
                // start_sop0,0,0,0,0,0,0,0,0,0,0,0,0,0,100,100,100,100,100,100,100,100,100,100,100,0,100,100,100,100,100,100,ende_sop

                const regexpResults = lastStrings.match('t_sop([^]+)ende_sop');
                if (regexpResults && regexpResults.length > 0) {
                    const statusStr = regexpResults[regexpResults.length - 1].replace('t_sop', '').replace(ENDE_SOP, '');
                    const rolladenStatus = statusStr.split(',').slice(0, controllerChannelCount || 32);
                    lastStrings = '';
                    // this.log.debug(rolladenStatus);
                    //check rolladenStatus
                    const statusKaputt = rolladenStatus.some(value => isNaN(value));
                    if (!statusKaputt) {
                        this.log.debug('Rolladenstatus erhalten');
                        wStatus(rolladenStatus);
                        readSop = true;
                    } else {
                        this.log.error('Rolladenstatus konnte nicht interpretiert werden: ' + statusStr);
                    }
                }

            } else if (lastStrings.indexOf(START_SKD) >= 0 && lastStrings.indexOf(ENDE_SKD) >= 0) {
                // Klima-Daten
                // start_skd37,999,999,999,999,19,0,18,19,0,0,0,0,0,37,1,ende_skd
                const klimaStr = lastStrings.substring(
                    lastStrings.indexOf(START_SKD) + START_SKD.length,
                    lastStrings.indexOf(ENDE_SKD, lastStrings.indexOf(START_SKD))
                );
                const klimadaten = klimaStr.split(',');
                lastStrings = '';
                this.log.debug('Klima gelesen: ' + klimadaten);
                wKlima(klimadaten);
                readSkd = true;
            } else if (lastStrings.indexOf(START_SMO) >= 0 && lastStrings.indexOf(ENDE_SMO) >= 0) {
                // Model Kennung
                let modelStr = lastStrings.substring(
                    lastStrings.indexOf(START_SMO) + START_SMO.length,
                    lastStrings.indexOf(ENDE_SMO, lastStrings.indexOf(START_SMO))
                );
                this.log.info('Model: ' + modelStr);
                modelStr = modelStr.replace('HEYtech ', '');
                if (this.config.autoDetect === true) {
                    this.setObjectNotExists('controller', {
                        type: 'state',
                        common: {
                            name: modelStr,
                            type: 'string',
                            role: 'indicator',
                            read: true,
                            write: false
                        },
                        native: {
                            model: modelStr
                        }
                    });
                } else {
                    this.extendObject('controller', {'native': {'model': modelStr}});
                }

                lastStrings = '';
                readSmo = true;
            } else if (lastStrings.indexOf(START_SMC) >= 0 && lastStrings.indexOf(ENDE_SMC) >= 0) {
                // Number of channels
                const noChannelStr = lastStrings.substring(
                    lastStrings.indexOf(START_SMC) + START_SMC.length,
                    lastStrings.indexOf(ENDE_SMC, lastStrings.indexOf(START_SMC))
                );
                this.log.debug('Number of Channels :' + noChannelStr);
                this.extendObject('controller', {'native': {'channels': noChannelStr}});
                controllerChannelCount = Number(noChannelStr);
                lastStrings = '';
                readSmc = true;
            } else if (lastStrings.indexOf(START_SFI) >= 0 && lastStrings.indexOf(ENDE_SFI) >= 0) {
                // Software Version
                const svStr = lastStrings.substring(
                    lastStrings.indexOf(START_SFI) + START_SFI.length,
                    lastStrings.indexOf(ENDE_SFI, lastStrings.indexOf(START_SFI))
                );
                this.log.info('Software version: ' + svStr);
                controllerSoftwareVersion = svStr;
                this.extendObject('controller', {'native': {'swversion': svStr}});
                lastStrings = '';
                readSfi = true;
            }

        });
    }

    const wOutputs = writeOutputs.bind(this);

    function writeOutputs(data) {
        const that = this;
        const n = data.length;

        for (let i = 0; i < n; i++) {
            const channel = data[i].split(',');
            if (channel[0] < 65) {
                const number = parseInt(channel[0]);
                let vRole;
                switch (channel[2]) {
                    case '1':
                        vRole = 'shutter';
                        break;
                    case '2':
                        vRole = 'device';
                        break;
                    case '3':
                        vRole = 'group';
                        break;
                    case '4':
                        vRole = 'device group';
                        break;
                }

                if (vRole === 'shutter' || vRole === 'group') {
                    that.setObjectNotExists('shutters', {
                        type: 'group',
                        common: {
                            name: 'Shutters',
                            type: 'string',
                            role: 'group',
                            read: true,
                            write: false
                        }
                    });
                    that.setObjectNotExists('shutters.' + number, {
                        type: 'channel',
                        common: {
                            name: channel[1],
                            type: 'boolean',
                            role: vRole,
                            read: true,
                            write: false
                        }
                    });
                    that.setObjectNotExists('shutters.' + number + '.up', {
                        type: 'state',
                        common: {
                            name: channel[1].trim() + ' up',
                            type: 'boolean',
                            role: 'button',
                            read: false,
                            write: true,
                            smartName: {
                                en: channel[1].trim() + ' up',
                                de: channel[1].trim() + ' up',
                                smartType: 'SWITCH'
                            }
                        }
                    });
                    that.setObjectNotExists('shutters.' + number + '.down', {
                        type: 'state',
                        common: {
                            name: channel[1] + ' down',
                            type: 'boolean',
                            role: 'button',
                            read: false,
                            write: true
                        }
                    });
                    that.setObjectNotExists('shutters.' + number + '.stop', {
                        type: 'state',
                        common: {
                            name: channel[1] + ' stop',
                            type: 'boolean',
                            role: 'button',
                            read: false,
                            write: true
                        }
                    });
                    that.setObjectNotExists('shutters.' + number + '.status', {
                        type: 'state',
                        common: {
                            name: channel[1] + ' status',
                            type: 'number',
                            role: 'indicator',
                            unit: '%',
                            read: true,
                            write: false
                        }
                    });
                    that.setObjectNotExists('shutters.' + number + '.percent', {
                        type: 'state',
                        common: {
                            name: channel[1] + ' percent',
                            type: 'number',
                            role: 'level',
                            unit: '%',
                            read: true,
                            write: true
                        }
                    });
                } else if (vRole === 'device' || vRole === 'device group') {
                    const patt = new RegExp('~');
                    const dimmer = patt.test(channel[1]);

                    if (dimmer === false) {
                        that.setObjectNotExists('devices', {
                            type: 'group',
                            common: {
                                name: 'Devices',
                                type: 'device',
                                role: 'group',
                                read: true,
                                write: false
                            }
                        });
                        that.setObjectNotExists('devices.' + number, {
                            type: 'channel',
                            common: {
                                name: channel[1],
                                type: 'boolean',
                                role: vRole,
                                read: true,
                                write: false
                            }
                        });
                        that.setObjectNotExists('devices.' + number + '.on', {
                            type: 'state',
                            common: {
                                name: channel[1] + ' on',
                                type: 'boolean',
                                role: 'switch',
                                read: true,
                                write: true
                            }
                        });
                    } else if (dimmer === true) {
                        that.setObjectNotExists('dimmer', {
                            type: 'group',
                            common: {
                                name: 'Dimmer',
                                type: 'string',
                                role: 'group',
                                read: true,
                                write: false
                            }
                        });
                        that.setObjectNotExists('dimmer.' + number, {
                            type: 'channel',
                            common: {
                                name: channel[1],
                                type: 'boolean',
                                role: vRole,
                                read: true,
                                write: false
                            }
                        });
                        that.setObjectNotExists('dimmer.' + number + '.on', {
                            type: 'state',
                            common: {
                                name: channel[1] + ' on',
                                type: 'boolean',
                                role: 'switch',
                                read: true,
                                write: true
                            }
                        });
                        that.setObjectNotExists('dimmer.' + number + '.level', {
                            type: 'state',
                            common: {
                                name: channel[1] + ' level',
                                type: 'number',
                                role: 'level.dimmer',
                                read: true,
                                write: true
                            }
                        });
                    }

                }
            } else if (channel[0] > 64) {
                const sceneNo = channel[0] - 64;
                that.setObjectNotExists('scenes', {
                    type: 'group',
                    common: {
                        name: 'Scenes',
                        type: 'string',
                        role: 'group',
                        read: true,
                        write: false
                    }
                });
                that.setObjectNotExists('scenes.' + sceneNo, {
                    type: 'channel',
                    common: {
                        name: channel[1],
                        type: 'boolean',
                        role: 'scene',
                        read: true,
                        write: false
                    }
                });
                that.setObjectNotExists('scenes.' + sceneNo + '.activate', {
                    type: 'state',
                    common: {
                        name: 'Activate' + channel[1],
                        type: 'boolean',
                        role: 'button',
                        read: false,
                        write: true
                    }
                });
            }

        }
    }

    const wStatus = writeStatus.bind(this);

    function writeStatus(data) {

        const that = this;

        for (let i = 0; i < data.length; i++) {
            const z = i + 1;
            const percent = Number(data[i]);
            if (!isNaN(percent)) {
                actualPercents[String(z)] = percent;
            }
            if (that.config.autoDetect === false) {
                that.getState('outputs.' + z + '.status', function (err, state) {
                    if (err) {
                        that.log.error(err);
                    } else if (state !== null && state.val !== data[i]) {
                        that.setState('outputs.' + z + '.status', {val: Number(data[i]), ack: true});
                    }
                });
            } else if (that.config.autoDetect === true) {
                //get all states that matches the id number
                that.getStates('shutters.*', function (err, states) {
                    //iterate thru all states
                    let keys = Object.keys(states);

                    //remove all states that are not for show values and scenes
                    const pArr = ['down', 'up', 'stop', 'scenes', 'undefined'];
                    for (const p in pArr) {
                        const patt = new RegExp(pArr[p]);
                        for (const x in keys) {
                            const test = patt.test(keys[x]);
                            if (test === true || !keys[x].startsWith(`heytech.${that['instance']}.shutters.${z}.`)) {
                                delete states[keys[x]];
                            }
                        }

                    }

                    keys = Object.keys(states);

                    for (let x = 0; x < keys.length; x++) {
                        if (keys[x] === 'undefined' || keys[x] === undefined) {
                            //noop
                        } else {
                            let key = keys[x].replace(/\w*\.\d.\w*\./g, '');
                            key = key.replace(/\.\w+$/g, '');
                            key = parseInt(key);

                            if (states[keys[x]] === undefined) {
                                //noop
                            } else {
                                let oldVal = null;
                                let ts = 0;
                                if (states[keys[x]] !== null) {
                                    oldVal = JSON.stringify(states[keys[x]]['val']);
                                    oldVal = oldVal.replace(/"/g, '');
                                    oldVal = oldVal.toString();
                                }
                                if (states[keys[x]] !== null) {
                                    ts = states[keys[x]]['ts'];
                                    //that.log.info(ts);
                                }

                                ts = parseInt(ts);
                                const wait = 1000;
                                const d = new Date();
                                const time = d.getTime();

                                const newVal = data[i];
                                if (key === z && time - ts > wait) {
                                    let test = keys[x].match(/\w+$/g);
                                    test = test.toString();

                                    const patt = new RegExp('shutters');
                                    const isShutter = patt.test(keys[x]);

                                    if ((test === 'status' || (test === 'level' && !isShutter)) && oldVal !== newVal) {
                                        that.setState(keys[x], {val: Number(data[i]), ack: true});
                                        if (isShutter && test === 'status') {
                                            that.setState(keys[x].replace('status', 'percent'), {
                                                val: Number(data[i]),
                                                ack: true
                                            });
                                        }
                                    } else if (test === 'on') {

                                        if (parseInt(data[i]) === 0 && (oldVal !== 'false' || oldVal === null)) {
                                            that.setState(keys[x], {val: false, ack: true});
                                        } else if (parseInt(data[i]) === 100 && (oldVal !== 'true' || oldVal === null)) {
                                            that.setState(keys[x], {val: true, ack: true});
                                        }
                                    }

                                }
                            }
                        }
                    }
                });
            }

        }

        if (that.config.groups && that.config.groups.length > 0) {
            that.config.groups.forEach(group => {
                const groupId = group.groupId;
                const shutters = group.shutters;
                let percentSum = 0;
                shutters.forEach(shutter => {
                    percentSum += (actualPercents[String(shutter)] || 0);
                });
                const avgPercent = Math.round(percentSum / shutters.length);
                that.getState('groups.' + groupId + '.status', function (err, state) {
                    if (err) {
                        that.log.error(err);
                    } else if (state === null || state.val !== avgPercent) {
                        that.setState('groups.' + groupId + '.status', {val: Number(avgPercent), ack: true});
                        that.setState('groups.' + groupId + '.percent', {val: Number(avgPercent), ack: true});
                    }
                });
            });
        }

    }

    const wKlima = writeKlima.bind(this);

    function writeKlima(data) {
        const that = this;

        if (that.config.autoDetect) {
            that.setObjectNotExists('sensors', {
                type: 'group',
                common: {
                    name: 'Sensor data',
                    type: 'string',
                    role: 'group',
                    read: true,
                    write: false
                }
            });
        }

        this.getStates('sensors.*', function (err, states) {
            let st;
            let vAlarm;
            let vWindM;
            let vWindA;
            let vRain;
            let vHumidity;
            let vTiMax;
            let vTiMin;
            let vTi;
            let vToMax;
            let vToMin;
            let vTo;
            let vBriAv;
            let vBriAc;

            for (st in states) {
                const name = st.replace(`heytech.${that['instance']}.sensors.`, '');
                if (states[st]) {
                    switch (name) {
                        case 'alarm':
                            vAlarm = states[st]['val'];
                            break;
                        case 'wind_maximum':
                            vWindM = states[st]['val'];
                            break;
                        case 'wind_actual':
                            vWindA = states[st]['val'];
                            break;
                        case 'rain':
                            vRain = states[st]['val'];
                            break;
                        case 'humidity':
                            vHumidity = states[st]['val'];
                            break;
                        case 'temp_indoor_max':
                            vTiMax = states[st]['val'];
                            break;
                        case 'temp_indoor_min':
                            vTiMin = states[st]['val'];
                            break;
                        case 'temp_indoor':
                            vTi = states[st]['val'];
                            break;
                        case 'temp_outdoor_max':
                            vToMax = states[st]['val'];
                            break;
                        case 'temp_outdoor_min':
                            vToMin = states[st]['val'];
                            break;
                        case 'temp_outdoor':
                            vTo = states[st]['val'].replace(',','.');
                            break;
                        case 'bri_average_sensor_byte':
                            vBriAv = states[st]['val'];
                            break;
                        case 'bri_actual_sensor_byte':
                            vBriAc = states[st]['val'];
                            break;
                    }
                }

            }


            if (that.config.briSensor === true || that.config.autoDetect) {
                if (vBriAc !== data[0]) {
                    that.setObjectNotExists('sensors.bri_actual', {
                        type: 'state',
                        common: {
                            name: 'Actual brightness',
                            type: 'number',
                            role: 'value.brightness',
                            unit: 'Lux',
                            read: true,
                            write: false
                        }
                    });
                    that.setObjectNotExists('sensors.bri_actual_hey', {
                        type: 'state',
                        common: {
                            name: 'Actual brightness as in Heytech App',
                            type: 'number',
                            role: 'value.brightness',
                            unit: 'Lux',
                            read: true,
                            write: false
                        }
                    });
                    that.setObjectNotExists('sensors.bri_actual_sensor_byte', {
                        type: 'state',
                        common: {
                            name: 'Actual brightness as byte from sensor',
                            type: 'number',
                            role: 'value.brightness',
                            unit: 'Byte',
                            read: true,
                            write: false
                        }
                    });
                    const resultLuxCustom = calculateLuxValueCustom(data[0]);
                    if (resultLuxCustom > 0) {
                        that.setState('sensors.bri_actual', {val: Number(resultLuxCustom), ack: true});
                    }

                    const resultLuxHeytech = calculateLuxValueBasedOnHeytech(data[0]);
                    if (resultLuxHeytech > 0) {
                        that.setState('sensors.bri_actual_hey', {val: Number(resultLuxHeytech), ack: true});
                    }
                    that.setState('sensors.bri_actual_sensor_byte', {val: Number(data[0]), ack: true});

                }
                if (vBriAv !== data[14]) {
                    that.setObjectNotExists('sensors.bri_average', {
                        type: 'state',
                        common: {
                            name: 'Average brightness',
                            type: 'number',
                            role: 'value.brightness',
                            unit: 'Lux',
                            read: true,
                            write: false
                        }
                    });
                    that.setObjectNotExists('sensors.bri_average_hey', {
                        type: 'state',
                        common: {
                            name: 'Average brightness as in Heytech App',
                            type: 'number',
                            role: 'value.brightness',
                            unit: 'Lux',
                            read: true,
                            write: false
                        }
                    });
                    that.setObjectNotExists('sensors.bri_average_sensor_byte', {
                        type: 'state',
                        common: {
                            name: 'Average brightness as byte from sensor',
                            type: 'number',
                            role: 'value.brightness',
                            unit: 'Byte',
                            read: true,
                            write: false
                        }
                    });
                    const resultLuxCustom = calculateLuxValueCustom(data[14]);
                    if (resultLuxCustom > 0) {
                        that.setState('sensors.bri_average', {val: Number(resultLuxCustom), ack: true});
                    }

                    const resultLuxHeytech = calculateLuxValueBasedOnHeytech(data[14]);
                    if (resultLuxHeytech > 0) {
                        that.setState('sensors.bri_average_hey', {val: Number(resultLuxHeytech), ack: true});
                    }
                    that.setState('sensors.bri_average_sensor_byte', {val: Number(data[14]), ack: true});
                }

            }

            if ((that.config.iTempSensor === true || that.config.humiditySensor === true || that.config.autoDetect) && data[1] !== '999') {
                if (vTi !== data[1] + '.' + data[2]) {
                    that.setObjectNotExists('sensors.temp_indoor', {
                        type: 'state',
                        common: {
                            name: 'Indoor temperature',
                            type: 'number',
                            role: 'value.temperature',
                            unit: '°C',
                            read: true,
                            write: false
                        }
                    });
                    that.setState('sensors.temp_indoor', {val: Number(data[1] + '.' + data[2]), ack: true});
                }
                if (vTiMin !== data[3]) {
                    that.setObjectNotExists('sensors.temp_indoor_min', {
                        type: 'state',
                        common: {
                            name: 'Indoor temperature minimum',
                            type: 'number',
                            role: 'value.temperature',
                            unit: '°C',
                            read: true,
                            write: false
                        }
                    });
                    that.setState('sensors.temp_indoor_min', {val: Number(data[3]), ack: true});
                }
                if (vTiMax !== data[4]) {
                    that.setObjectNotExists('sensors.temp_indoor_max', {
                        type: 'state',
                        common: {
                            name: 'Indoor temperature maximum',
                            type: 'number',
                            role: 'value.temperature',
                            unit: '°C',
                            read: true,
                            write: false
                        }
                    });
                    that.setState('sensors.temp_indoor_max', {val: Number(data[4]), ack: true});
                }

            }

            if ((that.config.oTempSensor === true || that.config.autoDetect) && data[5] !== '999') {
                if (vTo !== data[5] + '.' + data[6]) {
                    that.setObjectNotExists('sensors.temp_outdoor', {
                        type: 'state',
                        common: {
                            name: 'Outdoor temperature',
                            type: 'number',
                            role: 'value.temperature',
                            unit: '°C',
                            read: true,
                            write: false
                        }
                    });
                    that.setState('sensors.temp_outdoor', {val: Number(data[5] + '.' + data[6]), ack: true});
                }
                if (vToMin !== data[7]) {
                    that.setObjectNotExists('sensors.temp_outdoor_min', {
                        type: 'state',
                        common: {
                            name: 'Outdoor temperature minimum',
                            type: 'number',
                            role: 'value.temperature',
                            unit: '°C',
                            read: true,
                            write: false
                        }
                    });
                    that.setState('sensors.temp_outdoor_min', {val: Number(data[7]), ack: true});
                }
                if (vToMax !== data[8]) {
                    that.setObjectNotExists('sensors.temp_outdoor_max', {
                        type: 'state',
                        common: {
                            name: 'Outdoor temperature maximum',
                            type: 'number',
                            role: 'value.temperature',
                            unit: '°C',
                            read: true,
                            write: false
                        }
                    });
                    that.setState('sensors.temp_outdoor_max', {val: Number(data[8]), ack: true});
                }
            }

            if (that.config.windSensor === true || that.config.autoDetect) {
                if (vWindA !== data[9]) {
                    that.setObjectNotExists('sensors.wind_actual', {
                        type: 'state',
                        common: {
                            name: 'Actual wind speed',
                            type: 'number',
                            role: 'value',
                            unit: 'km/h',
                            read: true,
                            write: false
                        }
                    });
                    that.setState('sensors.wind_actual', {val: Number(data[9]), ack: true});
                }
                if (vWindM !== data[10]) {
                    that.setObjectNotExists('sensors.wind_maximum', {
                        type: 'state',
                        common: {
                            name: 'Maximum wind speed',
                            type: 'number',
                            role: 'value',
                            unit: 'km/h',
                            read: true,
                            write: false
                        }
                    });
                    that.setState('sensors.wind_maximum', {val: Number(data[10]), ack: true});
                }
            }

            if (that.config.alarmSensor === true || that.config.autoDetect) {
                if (vAlarm !== data[11]) {
                    that.setObjectNotExists('sensors.alarm', {
                        type: 'state',
                        common: {
                            name: 'Alarm',
                            type: 'number',
                            role: 'indicator',
                            states: '0:false;1:true',
                            read: true,
                            write: false
                        }
                    });
                    that.setState('sensors.alarm', {val: Number(data[11]), ack: true});
                }
            }

            if (that.config.rainSensor === true || that.config.autoDetect) {
                if (vRain !== data[12]) {
                    that.setObjectNotExists('sensors.rain', {
                        type: 'state',
                        common: {
                            name: 'Rain',
                            type: 'number',
                            role: 'indicator',
                            states: '0:false;1:true',
                            read: true,
                            write: false
                        }
                    });
                    that.setState('sensors.rain', {val: Number(data[12]), ack: true});
                }
            }

            if ((that.config.humiditySensor === true || that.config.autoDetect) && data[15] !== '999') {
                if (vHumidity !== data[15]) {
                    that.setObjectNotExists('sensors.humidity', {
                        type: 'state',
                        common: {
                            name: 'Humidity',
                            type: 'number',
                            role: 'value.humidity',
                            unit: '%',
                            read: true,
                            write: false
                        }
                    });
                    that.setState('sensors.humidity', {val: Number(data[15]), ack: true});
                }

            }

        });


    }
}


let cC;
let start;

class Heytech extends utils.Adapter {

    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'heytech'
        });
        this.on('ready', this.onReady.bind(this));
        this.on('objectChange', this.onObjectChange.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));

        cC = createClient.bind(this);
        const d = new Date();
        start = d.getTime();

    }


    /**
     * Is called when databases are connected and adapter received configuration.
     */
    onReady() {
        // Initialize your adapter here
        /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean letiable named "testletiable"
        Because every adapter instance uses its own unique namespace letiable names can't collide with other adapters letiables
        */
        if (this.config.autoDetect === false) {
            this.setObjectNotExists('controller', {
                type: 'state',
                common: {
                    name: this.config.typ,
                    type: 'boolean',
                    role: 'indicator',
                    read: true,
                    write: false
                },
                native: {}
            });

            let out = this.config.eBoxes * 8;

            switch (this.config.typ) {

                case 'RS874L':
                    out = out + 8;
                    break;
                case 'RS879':
                case 'RS879S':
                case 'RS879M':
                case 'WS879':
                case 'WS879M':
                    out = out + 32;
                    break;


            }

            if (this.config.briSensor === true || this.config.oTempSensor === true || this.config.iTempSensor === true || this.config.rainSensor === true || this.config.windSensor === true || this.config.alarmSensor === true) {
                this.setObjectNotExists('sensors', {
                    type: 'group',
                    common: {
                        name: 'Sensor data',
                        type: 'string',
                        role: 'group',
                        read: true,
                        write: false
                    }
                });
            }

            if (this.config.briSensor === true) {
                this.setObjectNotExists('sensors.bri_actual', {
                    type: 'state',
                    common: {
                        name: 'Actual brightness',
                        type: 'number',
                        role: 'value.brightness',
                        unit: 'kLux',
                        read: true,
                        write: false
                    }
                });
                this.setObjectNotExists('sensors.bri_average', {
                    type: 'state',
                    common: {
                        name: 'Average brightness',
                        type: 'number',
                        role: 'value.brightness',
                        unit: 'kLux',
                        read: true,
                        write: false
                    }
                });
            }

            if (this.config.oTempSensor === true) {
                this.setObjectNotExists('sensors.temp_outdoor', {
                    type: 'state',
                    common: {
                        name: 'Outdoor temperature',
                        type: 'number',
                        role: 'value.temperature',
                        unit: '°C',
                        read: true,
                        write: false
                    }
                });
                this.setObjectNotExists('sensors.temp_outdoor_min', {
                    type: 'state',
                    common: {
                        name: 'Outdoor temperature minimum',
                        type: 'number',
                        role: 'value.temperature',
                        unit: '°C',
                        read: true,
                        write: false
                    }
                });
                this.setObjectNotExists('sensors.temp_outdoor_max', {
                    type: 'state',
                    common: {
                        name: 'Outdoor temperature maximum',
                        type: 'number',
                        role: 'value.temperature',
                        unit: '°C',
                        read: true,
                        write: false
                    }
                });
            }

            if (this.config.iTempSensor === true || this.config.humiditySensor === true) {
                this.setObjectNotExists('sensors.temp_indoor', {
                    type: 'state',
                    common: {
                        name: 'Indoor temperature',
                        type: 'number',
                        role: 'value.temperature',
                        unit: '°C',
                        read: true,
                        write: false
                    }
                });
                this.setObjectNotExists('sensors.temp_indoor_min', {
                    type: 'state',
                    common: {
                        name: 'Indoor temperature minimum',
                        type: 'number',
                        role: 'value.temperature',
                        unit: '°C',
                        read: true,
                        write: false
                    }
                });
                this.setObjectNotExists('sensors.temp_indoor_max', {
                    type: 'state',
                    common: {
                        name: 'Indoor temperature maximum',
                        type: 'number',
                        role: 'value.temperature',
                        unit: '°C',
                        read: true,
                        write: false
                    }
                });
            }

            if (this.config.humiditySensor === true) {
                this.setObjectNotExists('sensors.humidity', {
                    type: 'state',
                    common: {
                        name: 'Humidity',
                        type: 'number',
                        role: 'value.humidity',
                        unit: '%',
                        read: true,
                        write: false
                    }
                });
            }

            if (this.config.rainSensor === true) {
                this.setObjectNotExists('sensors.rain', {
                    type: 'state',
                    common: {
                        name: 'Rain',
                        type: 'number',
                        role: 'indicator',
                        states: '0:false;1:true',
                        read: true,
                        write: false
                    }
                });
            }

            if (this.config.windSensor === true) {
                this.setObjectNotExists('sensors.wind_actual', {
                    type: 'state',
                    common: {
                        name: 'Actual wind speed',
                        type: 'number',
                        role: 'value',
                        unit: 'km/h',
                        read: true,
                        write: false
                    }
                });
                this.setObjectNotExists('sensors.wind_maximum', {
                    type: 'state',
                    common: {
                        name: 'Maximum wind speed',
                        type: 'number',
                        role: 'value',
                        read: true,
                        write: false
                    }
                });
            }

            if (this.config.alarmSensor === true) {
                this.setObjectNotExists('sensors.alarm', {
                    type: 'state',
                    common: {
                        name: 'Alarm',
                        type: 'number',
                        role: 'indicator',
                        states: '0:false;1:true',
                        read: true,
                        write: false
                    }
                });
            }


            for (let i = 0; i < out; i++) {
                const z = i + 1;
                this.setObjectNotExists('outputs', {
                    type: 'group',
                    common: {
                        name: 'Outputs',
                        type: 'string',
                        role: 'group',
                        read: true,
                        write: false
                    }
                });
                this.setObjectNotExists('outputs.' + z, {
                    type: 'channel',
                    common: {
                        name: 'Output ' + z,
                        type: 'boolean',
                        role: 'indicator',
                        read: true,
                        write: false
                    }
                });
                this.setObjectNotExists('outputs.' + z + '.up', {
                    type: 'state',
                    common: {
                        name: 'Output ' + z + ' up',
                        type: 'boolean',
                        role: 'button',
                        read: true,
                        write: true
                    }
                });
                this.setObjectNotExists('outputs.' + z + '.down', {
                    type: 'state',
                    common: {
                        name: 'Output ' + z + ' down',
                        type: 'boolean',
                        role: 'button',
                        read: true,
                        write: true
                    }
                });
                this.setObjectNotExists('outputs.' + z + '.stop', {
                    type: 'state',
                    common: {
                        name: 'Output ' + z + ' stop',
                        type: 'boolean',
                        role: 'button',
                        read: true,
                        write: true
                    }
                });
                this.setObjectNotExists('outputs.' + z + '.status', {
                    type: 'state',
                    common: {
                        name: 'Output ' + z + ' status',
                        type: 'number',
                        role: 'indicator',
                        unit: '%',
                        read: true,
                        write: false
                    }
                });

            }
        }

        if (this.config.groups && this.config.groups.length > 0) {
            this.setObjectNotExists('groups', {
                type: 'group',
                common: {
                    name: 'Shutter Groups',
                    type: 'string',
                    role: 'group',
                    read: true,
                    write: false
                }
            });
            this.config.groups.forEach((group) => {
                const groupId = group.groupId;
                const name = group.name;
                if (groupId && name && group.shutters && group.shutters.length > 0) {


                    const shutters = group.shutters.join(',');
                    const stateIdGroup = `groups.${groupId}`;
                    this.setObjectNotExists(stateIdGroup, {
                        type: 'group',
                        common: {
                            name: name,
                            type: 'string',
                            role: 'group',
                            read: true,
                            write: false
                        }
                    });
                    const stateIdName = `groups.${groupId}.name`;
                    this.setObjectNotExists(stateIdName, {
                        type: 'state',
                        common: {
                            name: 'Group ' + groupId + ' name',
                            type: 'string',
                            role: 'indicator',
                            read: true,
                            write: false
                        }
                    });
                    this.setState(stateIdName, {val: name, ack: true});

                    const stateIdRefs = `groups.${groupId}.refs`;
                    this.setObjectNotExists(stateIdRefs, {
                        type: 'state',
                        common: {
                            name: 'Group ' + groupId + ' referenced shutters',
                            type: 'string',
                            role: 'indicator',
                            read: true,
                            write: false
                        }
                    });
                    const stateIdStatus = `groups.${groupId}.status`;
                    this.setObjectNotExists(stateIdStatus, {
                        type: 'state',
                        common: {
                            name: 'Group ' + groupId + ' status',
                            type: 'number',
                            role: 'indicator',
                            unit: '%',
                            read: true,
                            write: false
                        }
                    });
                    this.setState(stateIdRefs, {val: Number(shutters), ack: true});
                    this.setObjectNotExists(`groups.${groupId}.up`, {
                        type: 'state',
                        common: {
                            name: 'Group ' + groupId + ' ' + name + ' up',
                            type: 'boolean',
                            role: 'switch',
                            read: false,
                            write: true
                        }
                    });
                    this.setObjectNotExists(`groups.${groupId}.down`, {
                        type: 'state',
                        common: {
                            name: 'Group ' + groupId + ' ' + name + ' down',
                            type: 'boolean',
                            role: 'switch',
                            read: false,
                            write: true
                        }
                    });
                    this.setObjectNotExists(`groups.${groupId}.stop`, {
                        type: 'state',
                        common: {
                            name: 'Group ' + groupId + ' ' + name + ' stop',
                            type: 'boolean',
                            role: 'switch',
                            read: false,
                            write: true
                        }
                    });
                    this.setObjectNotExists(`groups.${groupId}.percent`, {
                        type: 'state',
                        common: {
                            name: 'Group ' + groupId + ' ' + name + ' percent',
                            type: 'number',
                            role: 'level',
                            unit: '%',
                            read: true,
                            write: true
                        }
                    });
                }
            });

        }

        if (this.config.ip !== '' && this.config.port !== '') {
            cC();
            client.connect();
        }

        // in this template all states changes inside the adapters namespace are subscribed
        this.subscribeStates('*');


    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            this.log.info('cleaned everything up...');
            clearTimeout(checkShutterStatusClearTimeoutHandler);
            clearTimeout(sleepClearTimeoutHandler);
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed object changes
     * @param {string} id
     * @param {ioBroker.Object | null | undefined} obj
     */
    onObjectChange(id, obj) {
        if (obj) {
            // The object was changed
            this.log.debug(`object ${id} changed: ${JSON.stringify(obj)}`);
        } else {
            // The object was deleted
            this.log.info(`object ${id} deleted`);
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        // nur auf externe setStates lauschen
        if (state.from.indexOf('system.adapter.heytech') === 0) {
            // this.log.debug('Skipped', id, state);
            return;
        }
        const d = new Date();
        const now = d.getTime();
        const diff = now - start;

        if (state && diff > 10000 && readSmn) {
            // The state was changed
            const patt1 = new RegExp('down');
            const patt2 = new RegExp('up');
            const patt3 = new RegExp('stop');
            const patt4 = new RegExp('on');
            const patt5 = new RegExp('level');
            const patt6 = new RegExp('activate');
            const patt7 = new RegExp('percent');

            const res1 = patt1.test(id);
            const res2 = patt2.test(id);
            const res3 = patt3.test(id);
            const res4 = patt4.test(id);
            const res5 = patt5.test(id);
            const res6 = patt6.test(id);
            const res7 = patt7.test(id);

            const patternShutter = new RegExp('shutters');
            const isShutter = patternShutter.test(id);
            const patternGroups = new RegExp('groups');
            const isGroup = patternGroups.test(id);

            if (client === null) {
                cC();
            } else {
                if (res1 === true) {
                    const helper = id.replace('.down', '');
                    const no = helper.match(/\d*$/g);
                    if (isShutter) {
                        this.sendeHandsteuerungsBefehl(no[0], 'down');
                    } else if (isGroup) {
                        this.sendeHandsteuerungsBefehlToGroup(no[0], 'down');
                    }

                    this.log.info('down ' + no[0]);
                }

                if (res2 === true) {
                    const helper = id.replace('.up', '');
                    const no = helper.match(/\d*$/g);

                    if (isShutter) {
                        this.sendeHandsteuerungsBefehl(no[0], 'up');
                    } else if (isGroup) {
                        this.sendeHandsteuerungsBefehlToGroup(no[0], 'up');
                    }

                    this.log.info('up ' + no[0]);
                }

                if (res3 === true) {
                    const helper = id.replace('.stop', '');
                    const no = helper.match(/\d*$/g);

                    if (isShutter) {
                        this.sendeHandsteuerungsBefehl(no[0], 'off');
                    } else if (isGroup) {
                        this.sendeHandsteuerungsBefehlToGroup(no[0], 'off');
                    }

                    this.log.info('stop ' + no[0]);
                }

                if (res4 === true) {
                    const helper = id.replace('.on', '');
                    const no = helper.match(/\d*$/g);
                    const patt = new RegExp('dimmer');
                    const dim = patt.test(id);

                    if (dim === false) {
                        this.sendeHandsteuerungsBefehl(no[0], state.val === true ? 'up' : 'off');
                    } else if (dim === true) {
                        if (state.val === true) {

                            const lvl = id.replace('on', 'level');
                            this.setState(lvl, 100);
                        } else if (state.val === false) {
                            const lvl = id.replace('on', 'level');
                            this.setState(lvl, 0);

                        }
                    }

                    this.log.info('on');
                }

                if (res5 === true) {
                    const helper = id.replace('.level', '');
                    const no = helper.match(/\d*$/g);

                    this.sendeHandsteuerungsBefehl(no[0], state.val.toString());

                    this.log.info('level: ' + no[0] + ' ' + state.val);
                }


                if (res6 === true) {
                    const helper = id.replace('.acitivate', '');
                    const no = helper.match(/\d*$/g);

                    this.sendeSzenarioBefehl(no[0]);

                    this.log.info('activate');
                }

                if (res7 === true) {
                    const helper = id.replace('.percent', '');
                    const no = helper.match(/\d*$/g);

                    if (isShutter) {
                        if (this.checkNewerVersion()) {
                            this.sendeHandsteuerungsBefehl(no[0], state.val.toString());
                        } else {
                            this.gotoShutterPosition(no[0], state.val)();
                        }
                    } else if (isGroup) {
                        if (this.checkNewerVersion()) {
                            this.sendeHandsteuerungsBefehlToGroup(no[0], state.val.toString());
                        } else {
                            this.gotoShutterPositionGroups(no[0], state.val);
                        }
                    }

                    this.log.info('percent: ' + no[0] + ' ' + state.val);
                }

            }

            //this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            //this.log.info(`state ${id} deleted`);
        }
    }

    checkNewerVersion() {
        return (controllerSoftwareVersion[0] === '8' && controllerSoftwareVersion >= '8.027o') ||
            (controllerSoftwareVersion[0] === '1' && controllerSoftwareVersion >= '1.014p');
    }

    checkVersionCanSetPercentage() {
        return (controllerSoftwareVersion[0] === '8' && controllerSoftwareVersion >= '8.027r');
    }



    checkShutterStatus() {
        return _.debounce(async () => {
            const intervalID = setInterval(() => {
                client.send('sop');
                client.send(newLine);
            }, 5000);
            checkShutterStatusClearTimeoutHandler = setTimeout(() => {
                clearInterval(intervalID);
            }, 30000);
        }, 30000, {
            'leading': true,
            'trailing': false
        });
    }

    async sendeHandsteuerungsBefehlToGroup(groupdId, befehl) {
        const shutterRefsState = await this.getStateAsync(`groups.${groupdId}.refs`);
        if (shutterRefsState && shutterRefsState.val) {
            const shutters = shutterRefsState.val.split(',');
            shutters.forEach(rolladenId => {
                this.sendeHandsteuerungsBefehl(rolladenId, befehl);
            });
        }
    }

    async waitForRunningCommandCallbacks() {
        while (runningCommandCallbacks) {
            await this.sleep(500);
        }
    }

    async sendeHandsteuerungsBefehl(rolladenId, befehl) {
        const handsteuerungAusfuehrung = () => {
            runningCommandCallbacks = true;
            if (this.config.pin !== '') {
                client.send('rsc');
                client.send(newLine);
                client.send(this.config.pin.toString());
                client.send(newLine);
            }
            client.send('rhi');
            client.send(newLine);
            client.send(newLine);
            client.send('rhb');
            client.send(newLine);
            client.send(String(rolladenId));
            client.send(newLine);
            client.send(String(befehl));
            client.send(newLine);
            client.send(newLine);
            client.send('rhe');
            client.send(newLine);
            client.send(newLine);
            runningCommandCallbacks = false;
        };
        if (connected) {
            await this.waitForRunningCommandCallbacks();
            handsteuerungAusfuehrung();
            this.checkShutterStatus()();
        } else {
            if (!connecting) {
                client.disconnect();
            }
            commandCallbacks.push(handsteuerungAusfuehrung);
            if (!connecting) {
                connecting = true;
                client.connect();
            }
        }

    }

    sleep(milliseconds) {
        return new Promise(resolve => {
            sleepClearTimeoutHandler = setTimeout(resolve, milliseconds);
        });
    }

    async gotoShutterPositionGroups(groupdId, prozent) {
        const shutterRefsState = await this.getStateAsync(`groups.${groupdId}.refs`);
        if (shutterRefsState && shutterRefsState.val) {
            const shutters = shutterRefsState.val.split(',');
            shutters.forEach(rolladenId => {
                this.gotoShutterPosition(rolladenId, prozent)();
            });
        }
    }

    gotoShutterPosition(rolladenId, prozent) {
        return memoizeDebounce(async () => {
            this.log.debug(`Percent${rolladenId} ${prozent}`);
            // 100 = auf
            // 0 = zu
            const ziel = Number(prozent);

            if (ziel === 100) {
                this.sendeHandsteuerungsBefehl(rolladenId, 'up');
            } else if (ziel === 0) {
                this.sendeHandsteuerungsBefehl(rolladenId, 'down');
            } else {
                if(this.checkVersionCanSetPercentage()){
                    this.sendeHandsteuerungsBefehl(rolladenId, ziel);
                } else {
                    let status = actualPercents[String(rolladenId)];
                    let aktuellePosition = Number(status);
                    let direction = 'up';
                    if (aktuellePosition > ziel) {
                        direction = 'down';
                    } else if (aktuellePosition === ziel) {
                        direction = 'off';
                    }

                    this.sendeHandsteuerungsBefehl(rolladenId, direction);

                    while ((direction === 'down' && aktuellePosition > ziel) || (direction === 'up' && aktuellePosition < ziel)) {
                        status = actualPercents[String(rolladenId)];
                        aktuellePosition = Number(status);
                        await this.sleep(100);
                    }

                    this.sendeHandsteuerungsBefehl(rolladenId, 'off');
                }
            }
        }, 500);
    }

    async sendeRefreshBefehl() {
        const refreshBefehl = () => {
            runningCommandCallbacks = true;
            if (this.config.pin !== '') {
                client.send('rsc');
                client.send(newLine);
                client.send(this.config.pin.toString());
                client.send(newLine);
            }
            client.send('skd');
            client.send(newLine);
            runningCommandCallbacks = false;
        };
        if (connected) {
            await this.waitForRunningCommandCallbacks();
            refreshBefehl();
        } else {
            if (!connecting) {
                client.disconnect();
            }
            commandCallbacks.push(refreshBefehl);
            if (!connecting) {
                connecting = true;
                client.connect();
            }
        }

    }

    async sendeSzenarioBefehl(rolladenId) {
        const szenarioAusfuehrung = () => {
            runningCommandCallbacks = true;
            if (this.config.pin !== '') {
                client.send('rsc');
                client.send(newLine);
                client.send(this.config.pin);
                client.send(newLine);
            }
            client.send('rsa');
            client.send(newLine);
            client.send(rolladenId);
            client.send(newLine);
            client.send(newLine);
            client.send('sop');
            client.send(newLine);
            client.send(newLine);
            runningCommandCallbacks = false;
        };
        if (connected) {
            await this.waitForRunningCommandCallbacks();
            szenarioAusfuehrung();
            this.checkShutterStatus()();
        } else {
            if (!connecting) {
                client.disconnect();
            }
            commandCallbacks.push(szenarioAusfuehrung);
            if (!connecting) {
                connecting = true;
                client.connect();
            }
        }

    }
}


if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Heytech(options);
} else {
    // otherwise start the instance directly
    new Heytech();
}