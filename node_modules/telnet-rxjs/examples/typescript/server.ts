import { Event, Telnet } from '../../dist/telnet';

const port = 8765;
const server = Telnet.server(port);

server.filter((event) => event instanceof Telnet.Event.Started)
  .subscribe(() => {
    console.log('Server has started on port', 8765);
  });

server.filter((event) => event instanceof Telnet.Event.Connected)
  .subscribe((event: Event.Connected) => {
    const socket = event.connection.socket;

    if (!socket) {
      console.error('No socket for', event.connection);
      return;
    }

    console.log('Connection received from', socket.remoteAddress);
  });

server.start();
