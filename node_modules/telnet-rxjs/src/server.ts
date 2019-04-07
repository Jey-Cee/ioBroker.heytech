import * as net from 'net';
import * as tls from 'tls';
import * as url from 'url';

import { Observable } from 'rxjs/Observable';
import { ReplaySubject } from 'rxjs/ReplaySubject';

import { Connection } from './connection';
import { Event } from './event';
import { Protocol } from './protocol';

export class Server extends ReplaySubject<Event.Server> {
  private server: net.Server | tls.Server | undefined;
  private connections: Connection[];

  constructor(private options: any = {}) {
    super();

    this.connections = [];
  }

  public start() {
    return new Promise<net.Server | tls.Server>((resolve, reject) => {
      const protocol = this.options.hostUrl.protocol;
      this.next(new Event.Starting());

      switch (protocol) {
        case Protocol.TELNET:
          this.server = this.serverNoTls(this.options.hostUrl);
          break;
        case Protocol.TELNETS:
          this.server = this.serverTls(this.options.hostUrl);
          break;
      }

      if (!this.server) {
        throw new Error('No hostUrl protocol has been supplied.');
      }

      this.server.on('error', (error: any) => {
        this.error(error);
      });

      this.server.listen(Number(this.options.hostUrl.port), this.options.hostUrl.hostname, 5, () => {
        this.next(new Event.Started());
        resolve(this.server);
      });
    });
  }

  public stop() {
    return new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.next(new Event.Ending());

      if (this.connections) {
        this.connections.forEach((connection) => {
          connection.disconnect();
        });
      }

      this.server.close(() => {
        resolve();
        this.next(new Event.Ended());
      });
    });
  }

  private serverNoTls(hostUrl: url.Url) {
    return net.createServer({ ...this.options }, (conn: net.Socket) => {
      this.connectionFactory(conn);
    });
  }

  private serverTls(hostUrl: url.Url) {
    return tls.createServer({ ...this.options }, (conn: tls.TLSSocket) => {
      this.connectionFactory(conn);
    });
  }

  private connectionFactory(socket: net.Socket | tls.TLSSocket) {
    const connection = new this.options.clientClass({ socket }) as Connection;
    connection.filter((event) => event instanceof Event.Connected)
      .subscribe((_) => {
        this.connections.push(connection);
        this.next(new Event.Connected(connection));
      });
    connection.filter((event) => event instanceof Event.Disconnected)
      .subscribe((_) => {
        const pos = this.connections.indexOf(connection);
        if (pos !== -1) {
          this.connections.splice(pos, 1);
        }
        this.next(new Event.Disconnected(connection));
      });
    connection.connect();
  }
}
