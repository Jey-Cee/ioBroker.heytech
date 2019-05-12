# telnet-rxjs

A node.js telnet library that wraps the sockets with RxJS observables.

[![Build Status](https://travis-ci.org/herrevilkitten/telnet-rxjs.svg?branch=master)](https://travis-ci.org/herrevilkitten/telnet-rxjs)

## SYNPOSIS

### Connect to a remote server

```typescript
import { Telnet } from 'telnet-rxjs';

// const Telnet = require('telnet-rxjs').Telnet;

// const { Telnet } = require('telnet-rxjs');


const client = Telnet.client('www.yahoo.com:80');

let connected = false;

client.filter((event) => event instanceof Telnet.Event.Connected)
  .subscribe((event) => {
    connected = true;
    client.sendln('GET /');
  });

client.data
  .subscribe((data) => {
    if (!connected) {
      return;
    }
    console.log(data);
  });

client.connect();
```

### Start a server
```typescript
import { Telnet } from 'telnet-rxjs';

// const Telnet = require('telnet-rxjs').Telnet;

// const { Telnet } = require('telnet-rxjs');

const server = Telnet.server(80);

server.filter((event) => event instanceof Telnet.Event.Connected)
  .subscribe((event) => {
    const socket = event.connection.socket;

    if (!socket) {
      console.error('No socket for', event.connection);
      return;
    }

    console.log('Connection received from', socket.remoteAddress);
    event.connection.sendln('Hello!');
    event.connection.disconnect();
  });

server.start().then(() => {
  console.log('Server has been started.');
});
```

## INSTALLATION

```
npm install telnet-rxjs
```

### Dependencies

[RxJS](https://www.npmjs.com/package/rxjs)

## DESCRIPTION

`telnet-rxjs` is a simple wrapper around a telnet client or server, using [RxJS](https://github.com/ReactiveX/rxjs) for handling data received from the server.

### Telnet Client

#### Create a Connection

Connections are created by using the `Telnet.client` static factory method or `createClient` function.  This method takes two arguments

* The URI of the host to connect to
* Optionally, additional options to pass to the network socket

The URI should be in formats similar to `protocol:host:port`.  Host and port are both required.  Protocol can be either `telnet` or `telnets`, which uses a TLS connection.  If the protocol is not specified, it defaults to `telnet`.

The options can be any option accepted by the [net.connect](https://nodejs.org/dist/latest-v7.x/docs/api/net.html#net_net_connect_options_connectlistener) or [tls.connect](https://nodejs.org/dist/latest-v7.x/docs/api/tls.html#tls_tls_connect_options_callback) functions of Node.js.  For example, to create a TLS connection to a site with a self-signed certificate, this statement can be used:

```
const client = Telnet.client('telnets:some.example.com:8443', { rejectUnauthorized: false });
```

The factory method returns a `Telnet.Connection` object, which is a subclass of `Observable<Telnet.Event>`.

#### Listen for Events and Data
As an observable, the telnet connection can be subscribed to in order to receive data from the server.  The default subscription publishes `Telnet.Event` objects.

##### Client Events
All events have a `timestamp` field that is a `Date` object.

`Telnet.Event.Connecting`
Published when the client begins connecting to the server.  The event has a `connection` property for the client.

`Telnet.Event.Connected`
Published after a connection to the server has been established.  The event has a `connection` property for the client.

`Telnet.Event.Disconnecting`
Published when the client begins to disconnect from the server.  The event has a `connection` property for the client.

`Telnet.Event.Disconnected`
Published when the client has closed its connection to the server.  The event has a `connection` property for the client.

`Telnet.Event.Data`
Published when data is received from the server.  The event has a `data` field that is a string.

`Telnet.Event.Command`
Published when a [telnet command](http://www.faqs.org/rfcs/rfc854.html) has been received from the server.  The event has a `command` field that is a string of numbers.

Additional accessors are provided that act as filters for the `Data` and `Command` events.  The `data` accessor publishes each string of data.  The `commands` accessor publishes each array of numbers.

##### Listen for All Events

Events are all subclasses of Telnet.Event.

```
client.subscribe((event) => {
  console.log('Received event:', event);
});
```

##### Listen for Data

The data will be returned as a string.

```
client.data.subscribe((data) => {
  console.log('Received data:', data);
});
```
or
```
client.filter((event) => event instanceof Telnet.Event.Data).subscribe((event) => {
  console.log('Received data:', event.data);
});
```

##### Listen for Commands

The commands will be an array of numbers.

```
client.commands.subscribe((command) => {
  console.log('Received command:', command);
});
```
or
```
client.filter((event) => event instanceof Telnet.Event.Command).subscribe((event) => {
  console.log('Received command:', event.command);
});
```

##### Listen for Errors

```
client.subscribe(
  (event) => {
    console.log('Received event:', event);
  },
  (error) => {
    console.error('An error occurred:', error);
  }
);
```

or

```
client
  .catch((error) => {
    console.error('An error occurred:', error);
  })
  .subscribe((event) => {
    console.log('Received event:', event);
  });
```

#### Connect
The `connect` method must be called before any connections will be opened.  Configuration errors, such as missing port numbers, will cause an exception to be thrown.  Other errors will be reported on the error channel of the client observable.

#### Disconnect
The `disconnect` method closes the connection to the server.

### Telnet Server
Connections are created by using the `Telnet.server` static factory method or `createServer` function.  This method takes two arguments

* The URI of the server to create
* Optionally, additional options to pass to the network socket

The URI should be in formats similar to `protocol:host:port`.  Only the port is required.  Protocol can be either `telnet` or `telnets`, which uses a TLS connection.  If the protocol is not specified, it defaults to `telnet`.  If the host is not specified, it defaults to `0.0.0.0`.

The options can be any option accepted by the [net.createServer](https://nodejs.org/api/net.html#net_net_createserver_options_connectionlistener) or [tls.createServer](https://nodejs.org/api/tls.html#tls_tls_createserver_options_secureconnectionlistener) functions of Node.js.

The factory method returns a `Telnet.Server` object, which is a subclass of `Observable<Telnet.Event>`.

#### Listen for Events
As an observable, the telnet connection can be subscribed to in order to receive data from the server.  The default subscription publishes `Telnet.Event` objects.

##### Server Events
All events have a `timestamp` field that is a `Date` object.

`Telnet.Event.Connecting`
Published when a client begins connecting to the server. The event has a `connection` property for the client.

`Telnet.Event.Connected`
Published after a connection to the server has been established. The event has a `connection` property for the client.

`Telnet.Event.Disconnecting`
Published when a client begins to disconnect from the server. The event has a `connection` property for the client.

`Telnet.Event.Disconnected`
Published when a client has closed its connection to the server. The event has a `connection` property for the client.

`Telnet.Event.Starting`
Published when the server begins starting up.

`Telnet.Event.Started`
Published after the server has started up.

`Telnet.Event.Ending`
Published when the server begins shutting down.

`Telnet.Event.Ended`
Published after the server has shut down.

Additional accessors are provided that act as filters for the `Data` and `Command` events.  The `data` accessor publishes each string of data.  The `commands` accessor publishes each array of numbers.

#### Start
The `start` method must be called before the server will listen and any clients can connect.  Configuration errors, such as missing port numbers, will cause an exception to be thrown.  Other errors will be reported on the error channel of the server observable.

The method returns a promise that resolves to the [net.Server] to [tls.Server] object that underlies the connection, when the
`listen` method's callback is invoked.

#### Stop
The `stop` method will shutdown the server.  First, it will call the `disconnect` method on each connection.  Then, it will close the server port.

The method returns a promise that resolves when the `close` method's callback is invoked.

## LINKS

[Generated API Documentation](https://herrevilkitten.github.io/telnet-rxjs/)

[NPM Package](https://www.npmjs.com/package/telnet-rxjs)

[Telnet RFC](http://www.faqs.org/rfcs/rfc854.html)

## AUTHOR

Eric Kidder
