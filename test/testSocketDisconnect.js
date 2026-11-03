'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual connected-event handler from main.js without starting ioBroker.
function readConnectedHandler() {
	const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
	const eventMarker = '.filter(event => event instanceof Telnet.Event.Connected)';
	const eventStart = source.indexOf(eventMarker);
	assert.notEqual(eventStart, -1, 'Connected event handler not found');
	const callbackMarker = '.subscribe(async () => {';
	const start = source.indexOf(callbackMarker, eventStart);
	assert.notEqual(start, -1, 'Connected event subscription not found');
	const bodyStart = start + callbackMarker.length;
	const bodyEnd = source.indexOf('\n\t\t\t});', bodyStart);
	assert.notEqual(bodyEnd, -1, 'Connected event handler end not found');
	return source.slice(bodyStart, bodyEnd);
}

function createScenario(handlerBody, options = {}) {
	const executed = [];
	const warnings = [];
	const sent = [];
	const socket = { writable: true, writableEnded: false, destroyed: false };
	const client = {
		connected: true,
		socket,
		send(value) {
			if (!socket.writable || socket.destroyed) {
				throw new Error('Unexpected send on a disconnected socket');
			}
			sent.push(value);
		},
	};
	const context = vm.createContext({
		client,
		connected: false,
		connecting: false,
		runningCommandCallbacks: false,
		commandCallbacks: [],
		newLine: '\r\n',
		readSop: true,
		readSkd: true,
		readSmo: true,
		readSmc: true,
		readSfi: true,
		readSmn: !options.initialize,
	});
	let sleepCount = 0;
	let statusCalls = 0;
	const scenario = {
		executed,
		warnings,
		sent,
		context,
		disconnect() {
			context.connected = false;
			client.connected = false;
			socket.writable = false;
			socket.destroyed = true;
		},
	};
	const adapter = {
		config: { pin: '' },
		log: {
			debug() {},
			warn(message) {
				warnings.push(message);
			},
		},
		async waitForRunningCommandCallbacks() {
			if (options.onWait) {
				options.onWait(scenario);
			}
		},
		async sleep() {
			sleepCount += 1;
			if (options.onSleep) {
				options.onSleep(sleepCount, scenario);
			}
		},
		checkShutterStatus() {
			return () => {
				statusCalls += 1;
			};
		},
	};
	context.commandCallbacks.push(() => {
		executed.push('first');
		client.send('first');
	});
	context.commandCallbacks.push(() => {
		executed.push('second');
		client.send('second');
	});
	const handler = vm.runInContext('(async function () {' + handlerBody + '\n})', context);
	scenario.run = () => handler.call(adapter);
	scenario.statusCalls = () => statusCalls;
	return scenario;
}

describe('HEYtech socket guard during initialization and pending commands', () => {
	const handlerBody = readConnectedHandler();

	it('stops initialization when the connection is lost during its sleep', async () => {
		const scenario = createScenario(handlerBody, {
			initialize: true,
			onSleep: (count, state) => {
				if (count === 1) {
					state.disconnect();
				}
			},
		});
		await scenario.run();
		assert.deepEqual(scenario.executed, []);
		assert.equal(scenario.context.commandCallbacks.length, 2);
		assert.equal(scenario.warnings.length, 1);
	});

	it('does not run queued commands if the socket disconnects during the await', async () => {
		const scenario = createScenario(handlerBody, {
			onWait: state => state.disconnect(),
		});
		await scenario.run();
		assert.deepEqual(scenario.executed, []);
		assert.equal(scenario.statusCalls(), 0);
		assert.equal(scenario.context.commandCallbacks.length, 2);
		assert.equal(scenario.context.runningCommandCallbacks, false);
	});

	it('stops before the next queued command if the socket disconnects between callbacks', async () => {
		const scenario = createScenario(handlerBody, {
			onSleep: (count, state) => {
				if (count === 1) {
					state.disconnect();
				}
			},
		});
		await scenario.run();
		assert.deepEqual(scenario.executed, ['first']);
		assert.equal(scenario.context.commandCallbacks.length, 1);
		assert.equal(scenario.context.runningCommandCallbacks, false);
		assert.equal(scenario.warnings.length, 1);
	});

	it('executes the full queue when the socket remains connected', async () => {
		const scenario = createScenario(handlerBody);
		await scenario.run();
		assert.deepEqual(scenario.executed, ['first', 'second']);
		assert.equal(scenario.context.commandCallbacks.length, 0);
		assert.equal(scenario.context.runningCommandCallbacks, false);
		assert.deepEqual(scenario.warnings, []);
	});

	it('releases the processing flag when a callback throws', async () => {
		const scenario = createScenario(handlerBody);
		scenario.context.commandCallbacks[0] = () => {
			throw new Error('Callback failed');
		};
		await assert.rejects(scenario.run(), /Callback failed/);
		assert.equal(scenario.context.runningCommandCallbacks, false);
	});
});
