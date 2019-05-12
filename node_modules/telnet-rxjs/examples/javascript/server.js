const Telnet = require('../../dist/telnet').Telnet;

const port = 8765;
const server = Telnet.server(port);

server.filter((event) => event instanceof Telnet.Event.Started)
  .subscribe((event) => {
    console.log('Server has been started.');
  });

server.filter((event) => event instanceof Telnet.Event.Connected)
  .subscribe((event) => {
    const socket = event.connection.socket;

    if (!socket) {
      console.error('No socket for', event.connection);
      return;
    }

    console.log('Connection received from', socket.remoteAddress);
    event.connection.sendln('Hello!');
    event.connection.disconncet();
  });

server.start();
