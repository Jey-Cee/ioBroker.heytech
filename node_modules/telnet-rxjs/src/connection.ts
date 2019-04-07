import * as net from 'net';
import * as tls from 'tls';
import * as url from 'url';

import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';

import 'rxjs/add/operator/filter';
import 'rxjs/add/operator/map';

import { Command } from './command';
import { Event } from './event';
import { Protocol } from './protocol';

export class Connection extends ReplaySubject<Event> {
    public static readonly EOL = '\r\n';
    public static readonly DEFAULT_ENCODING = 'utf8';

    private PrivateSocket: tls.TLSSocket | net.Socket;
    private state: Connection.State = Connection.State.Disconnected;

    constructor(private options: Connection.IOptions = {}) {
        super();
        if (options.socket) {
            this.PrivateSocket = options.socket;
        } else {
            this.PrivateSocket = new net.Socket();
        }

        if (this.PrivateSocket.writable || this.PrivateSocket.readable) {
            this.state = Connection.State.Connected;
        }
    }

    get socket() {
        return this.PrivateSocket;
    }

    /**
     * An observable that tracks the data being sent to the client
     */
    get data(): Observable<string> {
        return this.filter((event: Event) => event instanceof Event.Data)
            .map((event) => (event as Event.Data).data);
    }

    /**
     * An observable that tracks any telnet commands sent to the client
     */
    get commands(): Observable<number[]> {
        return this.filter((event: Event) => event instanceof Event.Command)
            .map((event) => (event as Event.Command).command);
    }

    /**
     * Sends the given string to the server.
     *
     * @param data the string to send to the server
     */
    public send(data: string) {
        if (!this.PrivateSocket) {
            return;
        }

        this.PrivateSocket.write(data);
    }

    /**
     * Sends the given string to the server and then sends an EOL ("\r\n").
     *
     * @param data the string to send to the server
     */
    public sendln(data: string) {
        this.send(data);
        this.send(Connection.EOL);
    }

    /**
     * Connects to the server URI that was passed in with the constructor
     * @throws an error if the client cannot connect
     */
    public connect() {
        if (!this.connected) {
            if (!this.options.remoteUrl) {
                throw new Error('No remoteUrl is defined');
            }

            this.sendConnecting();
            const protocol = this.options.remoteUrl.protocol || Protocol.TELNET;

            if (!this.options.remoteUrl.port) {
                throw new Error('A port is required to connect to.');
            }

            switch (protocol) {
                case Protocol.TELNET:
                    this.PrivateSocket = this.connectNoTls(this.options.remoteUrl);
                    break;
                case Protocol.TELNETS:
                    this.PrivateSocket = this.connectTls(this.options.remoteUrl);
                    break;
                default:
                    throw new Error(this.options.remoteUrl.protocol + ' is not a supported protocol');
            }
        } else {
            this.sendConnected();
        }

        this.PrivateSocket.on('error', (error: any) => {
            this.error(error);
        });

        this.PrivateSocket.on('data', (data: number[]) => {
            const buffer = Buffer.alloc(data.length);
            let copied = 0;
            for (let cursor = 0; cursor < data.length; ++cursor) {
                if (data[cursor] === Command.IAC) {
                    cursor = this.handleTelnetCommand(data, cursor);
                } else {
                    buffer[copied++] = data[cursor];
                }
            }

            this.next(new Event.Data(buffer.toString(Connection.DEFAULT_ENCODING, 0, copied)));
        });

        /*
         * Close the connection if the server closes it
         */
        this.PrivateSocket.on('end', () => {
            this.disconnect();
        });

        return this.PrivateSocket;
    }

    /**
     * Close the telnet connection
     */
    public disconnect() {
        if (this.connected) {
            this.sendDisconnecting();
            this.PrivateSocket.end();
            this.PrivateSocket = new net.Socket();
            this.sendDisconnected();
        }
    }

    /**
     * Return whether the underlying socket is connected
     */
    public get connected() {
        return this.state === Connection.State.Connected;
    }

    /**
     * Processes in-band telnet commands.  Please see the relevant RFCs for more information.
     * Commands are published to the connetion observable as {@link Event.Command} and
     * can be responded to by filtering for this information.
     *
     * @param data the array of data for the current input
     * @param position the current position of the data cursor
     * @returns the new position of the data cursor
     */
    private handleTelnetCommand(data: number[], position: number) {
        const telnetCommand: number[] = [Command.IAC];

        // Used to store the new position of the buffer cursor
        position++;

        if (data[position] === Command.SB) {
            while (position < data.length) {
                telnetCommand.push(data[position++]);
                if (data[position] === Command.SE) {
                    break;
                }
            }
        } else {
            if (position < data.length) {
                telnetCommand.push(data[position++]);
            }
            if (position < data.length) {
                telnetCommand.push(data[position++]);
            }
        }
        this.next(new Event.Command(telnetCommand));

        return position;
    }

    private connectNoTls(hostUrl: url.Url) {
        return net.connect({
            ...this.options,
            host: hostUrl.hostname,
            port: Number(hostUrl.port),
        } as any, () => {
            this.sendConnected();
        });
    }

    private connectTls(hostUrl: url.Url) {
        return tls.connect({
            ...this.options,
            host: hostUrl.hostname,
            port: Number(hostUrl.port),
        } as any, () => {
            this.sendConnected();
        });
    }

    private sendDisconnecting() {
        this.state = Connection.State.Disconnecting;
        this.next(new Event.Disconnecting(this));
    }

    private sendDisconnected() {
        this.state = Connection.State.Disconnected;
        this.next(new Event.Disconnected(this));
    }

    private sendConnecting() {
        this.state = Connection.State.Connecting;
        this.next(new Event.Connecting(this));
    }

    private sendConnected() {
        this.state = Connection.State.Connected;
        this.next(new Event.Connected(this));
    }
}

export namespace Connection {
    export interface IOptions {
        socket?: net.Socket | tls.TLSSocket;
        remoteUrl?: url.Url;
        connectionClass?: any;
    }

    // TODO: when TypeDoc suppports TypeScript 2.4+, switch this back to an enum
    export type StateType = 'DISCONNECTED' | 'DISCONNECTING' | 'CONNECTING' | 'CONNECTED';
    export class State {
        public static Disconnected: 'DISCONNECTED' = 'DISCONNECTED';
        public static Disconnecting: 'DISCONNECTING' = 'DISCONNECTING';
        public static Connected: 'CONNECTED' = 'CONNECTED';
        public static Connecting: 'CONNECTING' = 'CONNECTING';
    }
}
