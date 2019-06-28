'use strict';

/*
 * Created with @iobroker/create-adapter v1.11.0
 */

const utils = require('@iobroker/adapter-core');

const _ = require('lodash');
const {Telnet} = require('telnet-rxjs');

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
let commandCallbacks = [];

let readSop = false;
let readSkd = false;
let readSmo = false;
let readSmc = false;
let readSfi = false;
let readSmn = false;


function createClient() {
    let lastStrings = '';

    if (this.config.ip === "" || this.config.ip === null || this.config.ip === undefined) {
        this.log.warn('No ip address in configuration found');
    } else if (this.config.port === "" || this.config.port === null || this.config.port === undefined) {
        this.log.warn('No port in configuration found');
    } else {

        client = Telnet.client(this.config.ip + ':' + this.config.port);
        setInterval(() => {
            this.sendeRefreshBefehl();
        }, this.config.refresh || 300000);

        client.filter((event) => event instanceof Telnet.Event.Connected)
            .subscribe(async () => {
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
                connected = true;

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
                    this.checkShutterStatus();

                    let zeitverzoegerung = 0;
                    let commandCallback;
                    do {
                        commandCallback = commandCallbacks.shift();
                        if (commandCallback) {
                            setTimeout(() => {
                                commandCallback();
                            }, zeitverzoegerung);
                            zeitverzoegerung += 500;
                        }
                    } while (commandCallbacks.length > 0);
                }

            });

        client.filter((event) => event instanceof Telnet.Event.Disconnected)
            .subscribe(() => {
                this.log.info('Disconnected from controller');
                connected = false;
            });

        client.subscribe(
            (event) => {
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
                if (lastStrings.indexOf(ENDE_SMN_START_STI) > 0 ) { //check end of smn data
                    smn = smn.concat(data); // erst hier concaten, weil ansonsten das if lastStrings.endsWith nicht mehr stimmt, weil die telnet Verbindung schon wieder was gesendet hat...
                    let channels = smn.match(/\d\d,.*,\d,/gm);
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
                let statusStr = lastStrings.substring(
                    lastStrings.lastIndexOf(START_SOP) + START_SOP.length,
                    lastStrings.lastIndexOf(ENDE_SOP)
                );
                const rolladenStatus = statusStr.split(',');
                lastStrings = '';
                // this.log.debug(rolladenStatus);
                //check rolladenStatus
                const statusKaputt = rolladenStatus.some(value => isNaN(value));
                if(!statusKaputt){
                    this.log.debug('Rolladenstatus erhalten');
                    wStatus(rolladenStatus);
                    readSop = true;
                }
            } else if (lastStrings.indexOf(START_SKD) >= 0 && lastStrings.indexOf(ENDE_SKD) >= 0) {
                // Klima-Daten
                // start_skd37,999,999,999,999,19,0,18,19,0,0,0,0,0,37,1,ende_skd
                let klimaStr = lastStrings.substring(
                    lastStrings.lastIndexOf(START_SKD) + START_SKD.length,
                    lastStrings.lastIndexOf(ENDE_SKD)
                );
                const klimadaten = klimaStr.split(',');
                lastStrings = '';
                this.log.debug('Klima gelesen');
                wKlima(klimadaten);
                readSkd = true;
            } else if (lastStrings.indexOf(START_SMO) >= 0 && lastStrings.indexOf(ENDE_SMO) >= 0) {
                // Model Kennung
                let modelStr = lastStrings.substring(
                    lastStrings.lastIndexOf(START_SMO) + START_SMO.length,
                    lastStrings.lastIndexOf(ENDE_SMO)
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
                        },
                    });
                } else {
                    this.extendObject('controller', {"native": {"model": modelStr}});
                }

                lastStrings = '';
                readSmo = true;
            } else if (lastStrings.indexOf(START_SMC) >= 0 && lastStrings.indexOf(ENDE_SMC) >= 0) {
                // Number of channels
                let noChannelStr = lastStrings.substring(
                    lastStrings.lastIndexOf(START_SMC) + START_SMC.length,
                    lastStrings.lastIndexOf(ENDE_SMC)
                );
                this.log.debug('Number of Channels :' + noChannelStr);
                this.extendObject('controller', {"native": {"channels": noChannelStr}});
                lastStrings = '';
                readSmc = true;
            } else if (lastStrings.indexOf(START_SFI) >= 0 && lastStrings.indexOf(ENDE_SFI) >= 0) {
                // Software Version
                let svStr = lastStrings.substring(
                    lastStrings.lastIndexOf(START_SFI) + START_SFI.length,
                    lastStrings.lastIndexOf(ENDE_SFI)
                );
                this.log.info('Software version: ' + svStr);
                this.extendObject('controller', {"native": {"swversion": svStr}});
                lastStrings = '';
                readSfi = true;
            }

        });
    }

    let wOutputs = writeOutputs.bind(this);

    function writeOutputs(data) {
        let that = this;
        let n = data.length;

        for (let i = 0; i < n; i++) {
            let z = i + 1;
            let channel = data[i].split(',');
            if (channel[0] < 65) {
                let number = parseInt(channel[0]);
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
                            name: channel[1] + ' up',
                            type: 'boolean',
                            role: 'button',
                            read: true,
                            write: true
                        }
                    });
                    that.setObjectNotExists('shutters.' + number + '.down', {
                        type: 'state',
                        common: {
                            name: channel[1] + ' down',
                            type: 'boolean',
                            role: 'button',
                            read: true,
                            write: true
                        }
                    });
                    that.setObjectNotExists('shutters.' + number + '.stop', {
                        type: 'state',
                        common: {
                            name: channel[1] + ' stop',
                            type: 'boolean',
                            role: 'button',
                            read: true,
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
                    // that.setObjectNotExists('shutters.' + number + '.level', {
                    //     type: 'state',
                    //     common: {
                    //         name: channel[1] + ' level',
                    //         type: 'number',
                    //         role: 'level.blind',
                    //         unit: '%',
                    //         read: true,
                    //         write: true
                    //     }
                    // });
                } else if (vRole === 'device' || vRole === 'device group') {
                    let patt = new RegExp('~');
                    let dimmer = patt.test(channel[1]);

                    if (dimmer === false) {
                        that.setObjectNotExists('devices', {
                            type: 'group',
                            common: {
                                name: 'Devices',
                                type: 'string',
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
                let sceneNo = channel[0] - 64;
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
                        read: true,
                        write: true
                    }
                });
            }

        }
    }

    let wStatus = writeStatus.bind(this);

    function writeStatus(data) {

        let that = this;

        for (let i = 0; i < data.length; i++) {
            let z = i + 1;
            if (that.config.autoDetect === false) {
                that.getState('outputs.' + z + '.status', function (err, state) {
                    if (err) {
                        that.log.error(err);
                    } else if (state !== null && state.val !== data[i]) {
                        that.setState('outputs.' + z + '.status', {val: data[i], ack: true});
                    }
                });
            } else if (that.config.autoDetect === true) {
                //get all states that matches the id number
                that.getStates('shutters.*', function (err, states) {
                    //iterate thru all states
                    let keys = Object.keys(states);

                    //remove all states that are not for show values and scenes
                    let pArr = ['down', 'up', 'stop', 'scenes', 'undefined'];
                    for (let p in pArr) {
                        let patt = new RegExp(pArr[p]);
                        for (let x in keys) {
                            let test = patt.test(keys[x]);
                            if (test === true || !keys[x].startsWith(`heytech.${that['instance']}.shutters.${z}.`)) {
                                delete states[keys[x]];
                            }
                        }

                    }

                    keys = Object.keys(states);

                    for (let x = 0; x < keys.length; x++) {
                        if (keys[x] === 'undefined' || keys[x] === undefined) {

                        } else {
                            let key = keys[x].replace(/\w*\.\d.\w*\./g, '');
                            key = key.replace(/\.\w+$/g, '');
                            key = parseInt(key);

                            if (states[keys[x]] === undefined) {

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
                                let wait = 1000;
                                let d = new Date();
                                let time = d.getTime();

                                let newVal = data[i];
                                if (key === z && time - ts > wait) {
                                    let test = keys[x].match(/\w+$/g);
                                    test = test.toString();

                                    let patt = new RegExp('shutters');
                                    let shutter = patt.test(keys[x]);

                                    if ((test === 'status' || (test === 'level' && !shutter)) && oldVal !== newVal) {
                                        that.setState(keys[x], {val: data[i], ack: true});
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
                })
            }

        }


    }

    let wKlima = writeKlima.bind(this);

    function writeKlima(data) {
        let that = this;

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
                let name = st.replace(`heytech.${that['instance']}.sensors.`, '');

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
                        vTo = states[st]['val'];
                        break;
                    case 'bri_average':
                        vBriAv = states[st]['val'];
                        break;
                    case 'bri_actual':
                        vBriAc = states[st]['val'];
                        break;
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
                    let briV = 0;
                    if (data[0] < 19) {
                        briV = data[0] * 1;
                    } else if (data[0] > 19 && data[0] < 29) {
                        briV = data[0] * 4;
                    } else if (data[0] > 29 && data[0] < 39) {
                        briV = data[0] * 8;
                    } else if (data[0] > 39 && data[0] < 49) {
                        briV = data[0] * 15;
                    } else if (data[0] > 49 && data[0] < 59) {
                        briV = data[0] * 22;
                    } else if (data[0] > 59 && data[0] < 69) {
                        briV = data[0] * 30;
                    } else if (data[0] > 69 && data[0] < 79) {
                        briV = data[0] * 40;
                    } else if (data[0] > 79 && data[0] < 89) {
                        briV = data[0] * 50;
                    } else if (data[0] > 89 && data[0] < 99) {
                        briV = data[0] * 64;
                    } else if (data[0] > 99 && data[0] < 109) {
                        briV = data[0] * 80;
                    } else if (data[0] > 109 && data[0] < 119) {
                        briV = data[0] * 100;
                    } else if (data[0] > 119 && data[0] < 129) {
                        briV = data[0] * 117;
                    } else if (data[0] > 129 && data[0] < 139) {
                        briV = data[0] * 138;
                    } else if (data[0] > 139 && data[0] < 149) {
                        briV = data[0] * 157;
                    } else if (data[0] > 149 && data[0] < 159) {
                        briV = data[0] * 173;
                    } else if (data[0] > 159 && data[0] < 169) {
                        briV = data[0] * 194;
                    } else if (data[0] > 169 && data[0] < 179) {
                        briV = data[0] * 212;
                    } else if (data[0] > 179 && data[0] < 189) {
                        briV = data[0] * 228;
                    } else if (data[0] > 189 && data[0] < 199) {
                        briV = data[0] * 247;
                    } else if (data[0] > 199 && data[0] < 209) {
                        briV = data[0] * 265;
                    } else if (data[0] > 209 && data[0] < 219) {
                        briV = data[0] * 286;
                    } else if (data[0] > 219 && data[0] < 229) {
                        briV = data[0] * 305;
                    } else if (data[0] > 229 && data[0] < 239) {
                        briV = data[0] * 322;
                    } else if (data[0] > 239 && data[0] < 249) {
                        briV = data[0] * 342;
                    } else if (data[0] > 249 && data[0] < 259) {
                        briV = data[0] * 360;
                    }
                    that.setState('sensors.bri_actual', {val: Math.round(briV), ack: true});
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
                    let briV = 0;
                    if (data[14] < 19) {
                        briV = data[14] * 1;
                    } else if (data[14] > 19 && data[14] < 29) {
                        briV = data[14] * 4;
                    } else if (data[14] > 29 && data[14] < 39) {
                        briV = data[14] * 8;
                    } else if (data[14] > 39 && data[14] < 49) {
                        briV = data[14] * 15;
                    } else if (data[14] > 49 && data[14] < 59) {
                        briV = data[14] * 22;
                    } else if (data[14] > 59 && data[14] < 69) {
                        briV = data[14] * 30;
                    } else if (data[14] > 69 && data[14] < 79) {
                        briV = data[14] * 40;
                    } else if (data[14] > 79 && data[14] < 89) {
                        briV = data[14] * 50;
                    } else if (data[14] > 89 && data[14] < 99) {
                        briV = data[14] * 64;
                    } else if (data[14] > 99 && data[14] < 109) {
                        briV = data[14] * 80;
                    } else if (data[14] > 109 && data[14] < 119) {
                        briV = data[14] * 100;
                    } else if (data[14] > 119 && data[14] < 129) {
                        briV = data[14] * 117;
                    } else if (data[14] > 129 && data[14] < 139) {
                        briV = data[14] * 138;
                    } else if (data[14] > 139 && data[14] < 149) {
                        briV = data[14] * 157;
                    } else if (data[14] > 149 && data[14] < 159) {
                        briV = data[14] * 173;
                    } else if (data[14] > 159 && data[14] < 169) {
                        briV = data[14] * 194;
                    } else if (data[14] > 169 && data[14] < 179) {
                        briV = data[14] * 212;
                    } else if (data[14] > 179 && data[14] < 189) {
                        briV = data[14] * 228;
                    } else if (data[14] > 189 && data[14] < 199) {
                        briV = data[14] * 247;
                    } else if (data[14] > 199 && data[14] < 209) {
                        briV = data[14] * 265;
                    } else if (data[14] > 209 && data[14] < 219) {
                        briV = data[14] * 286;
                    } else if (data[14] > 219 && data[14] < 229) {
                        briV = data[14] * 305;
                    } else if (data[14] > 229 && data[14] < 239) {
                        briV = data[14] * 322;
                    } else if (data[14] > 239 && data[14] < 249) {
                        briV = data[14] * 342;
                    } else if (data[14] > 249 && data[14] < 259) {
                        briV = data[14] * 360;
                    }
                    that.setState('sensors.bri_average', {val: Math.round(briV), ack: true});
                }

            }

            if ((that.config.iTempSensor === true || that.config.humiditySensor === true || that.config.autoDetect) && data[1] !== '999') {
                if (vTi !== data[1] + ',' + data[2]) {
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
                    that.setState('sensors.temp_indoor', {val: data[1] + ',' + data[2], ack: true});
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
                    that.setState('sensors.temp_indoor_min', {val: data[3], ack: true});
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
                    that.setState('sensors.temp_indoor_max', {val: data[4], ack: true});
                }

            }

            if ((that.config.oTempSensor === true || that.config.autoDetect) && data[5] !== '999') {
                if (vTo !== data[5] + ',' + data[6]) {
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
                    that.setState('sensors.temp_outdoor', {val: data[5] + ',' + data[6], ack: true});
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
                    that.setState('sensors.temp_outdoor_min', {val: data[7], ack: true});
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
                    that.setState('sensors.temp_outdoor_max', {val: data[8], ack: true});
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
                    that.setState('sensors.wind_actual', {val: data[9], ack: true});
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
                    that.setState('sensors.wind_maximum', {val: data[10], ack: true});
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
                    that.setState('sensors.alarm', {val: data[11], ack: true})
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
                    that.setState('sensors.rain', {val: data[12], ack: true})
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
                    that.setState('sensors.humidity', {val: data[15], ack: true})
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
        let d = new Date();
        start = d.getTime();

    }


    /**
     * Is called when databases are connected and adapter received configuration.
     */
    onReady() {
        // Initialize your adapter here
        /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean variable named "testVariable"
        Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
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
                native: {},
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
                let z = i + 1;
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

        let d = new Date();
        let now = d.getTime();
        let diff = now - start;

        if (state && diff > 10000 && readSmn) {
            // The state was changed
            let patt1 = new RegExp('down');
            let patt2 = new RegExp('up');
            let patt3 = new RegExp('stop');
            let patt4 = new RegExp('on');
            let patt5 = new RegExp('level');
            let patt6 = new RegExp('activate');

            let res1 = patt1.test(id);
            let res2 = patt2.test(id);
            let res3 = patt3.test(id);
            let res4 = patt4.test(id);
            let res5 = patt5.test(id);
            let res6 = patt6.test(id);

            if (client === null) {
                cC();
            } else {
                if (res1 === true) {
                    let helper = id.replace('.down', '');
                    let no = helper.match(/\d*$/g);

                    this.sendeHandsteuerungsBefehl(no[0], 'down');

                    this.log.info('down ' + no[0]);
                }

                if (res2 === true) {
                    let helper = id.replace('.up', '');
                    let no = helper.match(/\d*$/g);

                    this.sendeHandsteuerungsBefehl(no[0], 'up');

                    this.log.info('up ' + no[0]);
                }

                if (res3 === true) {
                    let helper = id.replace('.stop', '');
                    let no = helper.match(/\d*$/g);

                    this.sendeHandsteuerungsBefehl(no[0], 'off');

                    this.log.info('stop ' + no[0]);
                }

                if (res4 === true) {
                    let helper = id.replace('.on', '');
                    let no = helper.match(/\d*$/g);
                    let patt = new RegExp('dimmer');
                    let dim = patt.test(id);

                    if (dim === false) {
                        this.sendeHandsteuerungsBefehl(no[0], state.val === true ? 'up' : 'off');
                    } else if (dim === true) {
                        if (state.val === true) {

                            let lvl = id.replace('on', 'level');
                            this.setState(lvl, 100);
                        } else if (state.val === false) {
                            let lvl = id.replace('on', 'level');
                            this.setState(lvl, 0);

                        }
                    }

                    this.log.info('on');
                }

                if (res5 === true) {
                    let helper = id.replace('.level', '');
                    let no = helper.match(/\d*$/g);
                    let patt = new RegExp('shutters');
                    let shutter = patt.test(id);

                    if (shutter === true) {
                        this.gotoShutterPosition(no[0], state.val);
                    } else {
                    this.sendeHandsteuerungsBefehl(no[0], state.val.toString());
                    }


                    this.log.info('level: '+ no[0] +' '+ state.val);
                }


                if (res6 === true) {
                    let helper = id.replace('.acitivate', '');
                    let no = helper.match(/\d*$/g);

                    this.sendeSzenarioBefehl(no[0]);

                    this.log.info('activate');
                }

            }

            //this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            //this.log.info(`state ${id} deleted`);
        }
    }

    checkShutterStatus() {
        const intervalID = setInterval(() => {
            client.send('sop');
            client.send(newLine);
        }, 1000);
        setTimeout(() => {
            clearInterval(intervalID);
        }, 30000);
    }

    sendeHandsteuerungsBefehl(rolladenId, befehl) {
        let handsteuerungAusfuehrung = () => {
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
        };
        if (connected) {
            handsteuerungAusfuehrung();
            this.checkShutterStatus();
        } else {
            client.disconnect();
            commandCallbacks.push(handsteuerungAusfuehrung);
            client.connect();
        }

    }

    sleep(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds))
    }

    async gotoShutterPosition(rolladenId, prozent) {
        // if(rolladenId !== '10' && rolladenId !== '11') {
        //     return;
        // }
        // // 100 = auf
        // // 0 = zu
        // const ziel = Number(prozent);
        // let status = await this.getStateAsync(`shutters.${rolladenId}.status`);
        // let aktuellePosition = Number(status.val);
        // console.log(aktuellePosition);
        // let direction = 'up';
        // if (aktuellePosition > ziel) {
        //     direction = 'down';
        // } else if( aktuellePosition === ziel) {
        //     direction = 'off';
        // }
        //
        // this.sendeHandsteuerungsBefehl(rolladenId, direction);
        // while (!((ziel - 5) < aktuellePosition && aktuellePosition < (ziel + 5))) {
        //     aktuellePosition = Number((await this.getStateAsync(`shutters.${rolladenId}.status`)).val);
        //     await this.sleep(250);
        // }
        //
        // this.sendeHandsteuerungsBefehl(rolladenId, 'off');
    }

    sendeRefreshBefehl() {
        let refreshBefehl = () => {
            if (this.config.pin !== '') {
                client.send('rsc');
                client.send(newLine);
                client.send(this.config.pin.toString());
                client.send(newLine);
            }
            client.send('skd');
            client.send(newLine);
        };
        if (connected) {
            refreshBefehl();
        } else {
            client.disconnect();
            commandCallbacks.push(refreshBefehl);
            client.connect();
        }

    }

    sendeSzenarioBefehl(rolladenId) {
        let szenarioAusfuehrung = () => {
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
        };
        if (connected) {
            szenarioAusfuehrung();
            this.checkShutterStatus();
        } else {
            client.disconnect();
            commandCallbacks.push(szenarioAusfuehrung);
            client.connect();
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