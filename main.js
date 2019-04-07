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


function heyClient(cmd, no){
    let lastStrings = '';
    let connectedHeytechReader = false;

        if (this.config.ip === "" || this.config.ip === null || this.config.ip === undefined) {
            this.log.warn('No ip address in configuration found');
        } else if (this.config.port === "" || this.config.port === null || this.config.port === undefined) {
            this.log.warn('No port in configuration found');
        } else {

            const client = Telnet.client(this.config.ip + ':' + this.config.port);


            lastStrings = '';

            client.filter((event) => event instanceof Telnet.Event.Connected)
                .subscribe(() => {
                    this.log.info('Connected to controller');

                    if (this.config.pin !== '') {
                        client.send('rsc');
                        client.send(newLine);
                        client.send(this.config.pin);
                        client.send(newLine);
                        client.send(newLine);
                    }
                    client.send('skd');
                    client.send(newLine);
                    client.send(newLine);

                });

            client.filter((event)=> event instanceof Telnet.Event.Disconnected)
                .subscribe(()=>{
                    this.log.info('Disconnected from controller');
                    client.connect()
                });

            client.subscribe(
                (event) => {
                    //this.log.info('Received event:', event);
                },
                (error) => {
                    this.log.error('An error occurred:', error);
                }
            );

            client.data
                .subscribe((data) => {
                    this.log.info(data);
                    if (!connectedHeytechReader) {
                        return;
                    }
                    lastStrings = lastStrings.concat(data);
                    //this.log.info(data);
                    // SOP  Oeffnungs-Prozent
                    if (lastStrings.indexOf(START_SOP) >= 0 && lastStrings.indexOf(ENDE_SOP) >= 0) {
                        // start_sop0,0,0,0,0,0,0,0,0,0,0,0,0,0,100,100,100,100,100,100,100,100,100,100,100,0,100,100,100,100,100,100,ende_sop
                        let statusStr = lastStrings.substring(
                            lastStrings.indexOf(START_SOP) + START_SOP.length,
                            lastStrings.indexOf(ENDE_SOP)
                        );
                        const rolladenStatus = statusStr.split(',');
                        lastStrings = '';
                        //client.disconnect();
                        //connectedHeytechReader = false;
                        //resolve(rolladenStatus);
                        this.log.info(rolladenStatus);
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
                        //client.disconnect();
                        //connectedHeytechReader = false;
                        //resolve(klimadaten);
                        this.log.info(klimadaten);
                        wKlima(klimadaten);
                    }
                });
            connectedHeytechReader = true;
            if(cmd === null) {
                client.connect();
            }

            if(cmd === 'down'){
                this.log.info('Test');
                if(this.config.pin !== ''){
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
                client.send(no);
                client.send(newLine);
                client.send(cmd);
                client.send(newLine);
                client.send(newLine);
            }

        }

        let wStatus = writeStatus.bind(this);

        function writeStatus(data){

            for(let i = 0; i < data.length; i++){
                let z = i + 1;
                this.setState('outputs.' + z + '.status', {val: data[i], ack: true});
            }

        }

        let wKlima = writeKlima.bind(this);

        function writeKlima(data){
            if(this.config.briSensor === true){
                this.setState('sensors.bri_actual', {val: data[0], ack: true});
                this.setState('sensors.bri_average', {val: data[14], ack: true});
            }

            if(this.config.iTempSensor === true || this.config.humiditySensor === true){
                this.setState('sensors.temp_indoor', {val: data[1] + ',' + data[2], ack: true});
                this.setState('sensors.temp_indoor_min', {val: data[3], ack: true});
                this.setState('sensors.temp_indoor_max', {val: data[4], ack: true});
            }

            if(this.config.oTempSensor === true){
                this.setState('sensors.temp_outdoor', {val: data[5] + ',' + data[6], ack: true});
                this.setState('sensors.temp_outdoor_min', {val: data[7], ack: true});
                this.setState('sensors.temp_outdoor_max', {val: data[8], ack: true});
            }

            if(this.config.windSensor === true){
                this.setState('sensors.wind_actual', {val: data[9], ack: true});
                this.setState('sensors.wind_maximum', {val: data[10], ack: true});
            }

            if(this.config.alarmSensor === true){
                this.setState('sensors.alarm', {val: data[11], ack: true})
            }

            if(this.config.rainSensor === true){
                this.setState('sensors.rain', {val: data[12], ack: true})
            }

            if(this.config.humiditySensor === true){
                this.setState('sensors.humidity', {val: data[15], ack: true})
            }
        }

        //let sCmd = sendCommand.bind(this);




}

let hc;

class Heytech extends utils.Adapter {

    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'heytech'
        });
        hc = heyClient.bind(this);
        this.on('ready', this.onReady.bind(this));
        this.on('objectChange', this.onObjectChange.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));


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

        hc(null);
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
            if(res1 === true){
                //this.log.info('Test res1');
                hc(res1, 1);
            }
            if(res2 === true){
                //this.log.info('Test res2');
                hc(res2, 1);
            }
            if(res3 === true){
                //this.log.info('Test res3');
                hc(res3, 1);
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