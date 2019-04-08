'use strict';

/*
 * Created with @iobroker/create-adapter v1.11.0
 */

const utils = require('@iobroker/adapter-core');

const _ = require('lodash');
const { Telnet } = require('telnet-rxjs');

const newLine = String.fromCharCode(13);
const START_SOP = 'start_sop';
const ENDE_SOP = 'ende_sop';
const START_SKD = 'start_skd';
const ENDE_SKD = 'ende_skd';

let client = null;


function createClient(){
    let lastStrings = '';

    if (this.config.ip === "" || this.config.ip === null || this.config.ip === undefined) {
        this.log.warn('No ip address in configuration found');
    } else if (this.config.port === "" || this.config.port === null || this.config.port === undefined) {
        this.log.warn('No port in configuration found');
    } else {

        client = Telnet.client(this.config.ip + ':' + this.config.port);
    }

    client.filter((event) => event instanceof Telnet.Event.Connected)
        .subscribe(() => {
            this.log.info('Connected to controller');
            client.send('skd');
            client.send(newLine);
            client.send(newLine);

            //client.send('rhi' + newLine + newLine + 'rhb' + newLine + '1' + newLine + 'up' + newLine + newLine);
            /*client.send(newLine);
            client.send(newLine);
            client.send('rhb');
            client.send(newLine);
            client.send('1');
            client.send(newLine);
            client.send('up');
            client.send(newLine);
            client.send(newLine);*/

        });

    client.filter((event) => event instanceof Telnet.Event.Disconnected)
        .subscribe(() => {
            this.log.info('Disconnected from controller');
            client.connect()
        });

    client.subscribe(
        (event) => {
            console.log('Received event:', event);
        },
        (error) => {
            console.error('An error occurred:', error);
        }
    );

    let wait;

    client.data.subscribe((data) => {

            clearTimeout(wait);

            let that = this;

        wait = setTimeout(function(){
            that.log.debug('No data received within last 2 seconds');
            client.send('skd');
            client.send(newLine);
            client.send(newLine);
        }, 2000);

            lastStrings = lastStrings.concat(data);

            // SOP  Oeffnungs-Prozent
            if (lastStrings.indexOf(START_SOP) >= 0 && lastStrings.indexOf(ENDE_SOP) >= 0) {
                // start_sop0,0,0,0,0,0,0,0,0,0,0,0,0,0,100,100,100,100,100,100,100,100,100,100,100,0,100,100,100,100,100,100,ende_sop
                let statusStr = lastStrings.substring(
                    lastStrings.indexOf(START_SOP) + START_SOP.length,
                    lastStrings.indexOf(ENDE_SOP)
                );
                const rolladenStatus = statusStr.split(',');
                lastStrings = '';
                this.log.debug(rolladenStatus);
                wStatus(rolladenStatus);
            } else if (lastStrings.indexOf(START_SKD) >= 0 && lastStrings.indexOf(ENDE_SKD) >= 0) {
                // Klima-Daten
                // start_skd37,999,999,999,999,19,0,18,19,0,0,0,0,0,37,1,ende_skd
                let klimaStr = lastStrings.substring(
                    lastStrings.indexOf(START_SKD) + START_SKD.length,
                    lastStrings.indexOf(ENDE_SKD)
                );
                const klimadaten = klimaStr.split(',');
                lastStrings = '';
                this.log.debug(klimadaten);
                wKlima(klimadaten);
            }

        });

    let wStatus = writeStatus.bind(this);

    function writeStatus(data){

        let that = this;

        for(let i = 0; i < data.length; i++){
            let z = i + 1;
            this.getState('outputs.' + z + '.status', function(err, state){
                if(state.val !== data[i]){
                    that.setState('outputs.' + z + '.status', {val: data[i], ack: true});
                }
            });

        }

    }

    let wKlima = writeKlima.bind(this);

    function writeKlima(data){
        let that = this;
        this.getStates('sensors.*', function(err, states){
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

            for(st in states){
                let name = st.replace(`heytech.${that['instance']}.sensors.`, '');

                switch(name){
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

            if(that.config.briSensor === true){
                if(vBriAc !== data[0]){
                    that.setState('sensors.bri_actual', {val: data[0], ack: true});
                }
                if(vBriAv !== data[14]){
                    that.setState('sensors.bri_average', {val: data[14], ack: true});
                }

            }

            if(that.config.iTempSensor === true || that.config.humiditySensor === true){
                if(vTi !== data[1] + ',' + data[2]){
                    that.setState('sensors.temp_indoor', {val: data[1] + ',' + data[2], ack: true});
                }
                if(vTiMin !== data[3]){
                    that.setState('sensors.temp_indoor_min', {val: data[3], ack: true});
                }
                if(vTiMax !== data[4]){
                    that.setState('sensors.temp_indoor_max', {val: data[4], ack: true});
                }

            }

            if(that.config.oTempSensor === true){
                if(vTo !== data[5] + ',' + data[6]){
                    that.setState('sensors.temp_outdoor', {val: data[5] + ',' + data[6], ack: true});
                }
                if(vToMin !== data[7]){
                    that.setState('sensors.temp_outdoor_min', {val: data[7], ack: true});
                }
                if(vToMax !== data[8]){
                    that.setState('sensors.temp_outdoor_max', {val: data[8], ack: true});
                }
            }

            if(that.config.windSensor === true){
                if(vWindA !== data[9]){
                    that.setState('sensors.wind_actual', {val: data[9], ack: true});
                }
                if(vWindM !== data[10]){
                    that.setState('sensors.wind_maximum', {val: data[10], ack: true});
                }
            }

            if(that.config.alarmSensor === true){
                if(vAlarm !== data[11]){
                    that.setState('sensors.alarm', {val: data[11], ack: true})
                }
            }

            if(that.config.rainSensor === true){
                if(vRain !== data[12]){
                    that.setState('sensors.rain', {val: data[12], ack: true})
                }
            }

            if(that.config.humiditySensor === true){
                if(vHumidity !== data[15]){
                    that.setState('sensors.humidity', {val: data[15], ack: true})
                }

            }
            
        });

        
    }
}

let cC;

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

        if(this.config.briSensor === true || this.config.oTempSensor === true || this.config.iTempSensor === true || this.config.rainSensor === true || this.config.windSensor === true || this.config.alarmSensor === true){
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

        if(this.config.briSensor === true){
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

        if(this.config.oTempSensor === true){
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

        if(this.config.iTempSensor === true || this.config.humiditySensor === true){
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

        if(this.config.humiditySensor === true){
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

        if(this.config.rainSensor === true){
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

        if(this.config.windSensor === true){
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

        if(this.config.alarmSensor === true){
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
        cC();
        client.connect();
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
        if (state) {
            // The state was changed
            let patt1 = new RegExp('down');
            let patt2 = new RegExp('up');
            let patt3 = new RegExp('stop');
            let res1 = patt1.test(id);
            let res2 = patt2.test(id);
            let res3 = patt3.test(id);
            if(client === null){
                cC();
            }else {
                if (res1 === true) {
                    let helper = id.replace('.down', '');
                    let no = helper.match(/\d*$/g);

                    if (this.config.pin !== '') {
                        client.send('rsc');
                        client.send(newLine);
                        client.send(this.config.pin);
                        client.send(newLine);
                        client.send(newLine);
                    }
                    client.send('rhi');
                    client.send(newLine);
                    client.send(newLine);
                    client.send('rhb');
                    client.send(newLine);
                    client.send(no[0]);
                    client.send(newLine);
                    client.send('down');
                    client.send(newLine);
                    client.send(newLine);

                    this.log.info(no[0] + ' down');

                }
                if (res2 === true) {
                    let helper = id.replace('.up', '');
                    let no = helper.match(/\d*$/g);

                    if (this.config.pin !== '') {
                        client.send('rsc');
                        client.send(newLine);
                        client.send(this.config.pin);
                        client.send(newLine);
                        client.send(newLine);
                    }
                    client.send('rhi');
                    client.send(newLine);
                    client.send(newLine);
                    client.send('rhb');
                    client.send(newLine);
                    client.send(no[0]);
                    client.send(newLine);
                    client.send('up');
                    client.send(newLine);
                    client.send(newLine);

                    this.log.info(no[0] + ' up');

                }
                if (res3 === true) {
                    let helper = id.replace('.stop', '');
                    let no = helper.match(/\d*$/g);

                    if (this.config.pin !== '') {
                        client.send('rsc');
                        client.send(newLine);
                        client.send(this.config.pin);
                        client.send(newLine);
                        client.send(newLine);
                    }
                    client.send('rhi');
                    client.send(newLine);
                    client.send(newLine);
                    client.send('rhb');
                    client.send(newLine);
                    client.send(no[0]);
                    client.send(newLine);
                    client.send('stop');
                    client.send(newLine);
                    client.send(newLine);

                    this.log.info(no[0] + ' stop');
                }
            }

            //this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
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