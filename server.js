#!/usr/bin/env nodeSQL
/*jshint esversion: 6 */
const serverID = new Date().getTime();

import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';
import http from 'http';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cors from 'cors';
import express from 'express';
import {log, logObj, logs} from 'xeue-logs';
import {config} from 'xeue-config';
import mariadb from 'mariadb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer');

const {version} = require('./package.json');
const type = 'Server';
const pingList = [];

class SQLSession {
	constructor() {
		this.pool = mariadb.createPool({
			host: config.get('dbHost'),
			user: config.get('dbUser'),
			port: config.get('dbPort'),
			password: config.get('dbPass'),
			connectionLimit: 5
		});
		this.init();
	}

	async init() {
		log('Initialising SQL database', 'S');
		try {
			await this.query(`CREATE DATABASE IF NOT EXISTS ${config.get('dbDatabase')};`);
			this.pool = mariadb.createPool({
				host: config.get('dbHost'),
				user: config.get('dbUser'),
				port: config.get('dbPort'),
				password: config.get('dbPass'),
				database: config.get('dbDatabase'),
				connectionLimit: 5
			});
		} catch (error) {
			log(`Could not check for or create the required database: ${config.get('dbDatabase')}`, 'E');
		}
		try {
			await this.tableCheck('temperature', `CREATE TABLE \`temperature\` (
				\`PK\` int(11) NOT NULL,
				\`frame\` text NOT NULL,
				\`temperature\` float NOT NULL,
				\`system\` text NOT NULL,
				\`time\` timestamp NOT NULL DEFAULT current_timestamp(),
				PRIMARY KEY (\`PK\`)
			) ENGINE=InnoDB DEFAULT CHARSET=latin1`, 'PK');

			await this.tableCheck('status', `CREATE TABLE \`status\` (
				\`PK\` int(11) NOT NULL,
				\`Type\` varchar(255) NOT NULL,
				\`Status\` tinyint(1) NOT NULL,
				\`Time\` timestamp NOT NULL DEFAULT current_timestamp(),
				\`System\` varchar(256) DEFAULT NULL,
				PRIMARY KEY (\`PK\`)
			) ENGINE=InnoDB DEFAULT CHARSET=latin1`, 'PK');

			await this.tableCheck('config', `CREATE TABLE \`config\` (
				\`PK\` int(11) NOT NULL,
				\`warnPing\` tinyint(1) DEFAULT 1,
				\`warnTemp\` tinyint(1) DEFAULT 1,
				\`warnBoot\` tinyint(1) DEFAULT 1,
				\`warnDev\` tinyint(1) DEFAULT 1,
				\`warnFlap\` tinyint(1) DEFAULT 1,
				\`warnPhy\` tinyint(1) DEFAULT 1,
				\`warnUPS\` tinyint(1) DEFAULT 1,
				\`warnFibre\` tinyint(1) DEFAULT 1,
				\`warnEmails\` text DEFAULT NULL,
				\`Time\` timestamp NOT NULL DEFAULT current_timestamp(),
				\`System\` varchar(256) DEFAULT NULL,
				PRIMARY KEY (\`PK\`)
			) ENGINE=InnoDB DEFAULT CHARSET=latin1`, 'PK');
		} catch (error) {
			log('Could not check for or create the required tables', 'E');
		}
		log('Tables initialised', 'S');
	}

	async tableCheck(table, tableDef, pk) {
		const rows = await this.query(`SELECT count(*) as count
			FROM information_schema.TABLES
			WHERE (TABLE_SCHEMA = '${config.get('dbDatabase')}') AND (TABLE_NAME = '${table}')
		`);
		if (rows[0].count == 0) {
			log(`Table: ${table} is being created`, 'S');
			await this.query(tableDef);
			await this.query(`ALTER TABLE \`${table}\` MODIFY \`${pk}\` int(11) NOT NULL AUTO_INCREMENT;`);
		}
	}

	async query(query) {
		try {
			const conn = await this.pool.getConnection();
			const rows = await conn.query(query);
			conn.end();
			return rows;
		} catch (error) {
			logs.error('SQL Error', error);
		}
	}

	async insert(_values, table) { // { affectedRows: 1, insertId: 1, warningStatus: 0 }
		try {
			const query = `INSERT INTO ${table}(${Object.keys(_values).join(',')}) values ('${Object.values(_values).join('\',\'')}')`;
			const result = await this.query(query);
			return result;
		} catch (error) {
			logs.error('SQL Error', error);
		}
	}

	async update(_values, _conditions, table) {
		try {
			let where = '';
			switch (typeof _conditions) {
			case 'undefined':
				where = '';
				break;
			case 'string':
				where = 'WHERE '+_conditions;
				break;
			case 'object':
				where = 'WHERE '+_conditions.join(' and ');
				break;
			default:
				break;
			}
			const values = Object.keys(_values).map(key => `${key} = ${_values[key]}`).join(',');
			const query = `UPDATE ${table} SET ${values} ${where}`;
			const result = await this.query(query);
			return result;
		} catch (error) {
			logs.error('SQL Error', error);
		}
	}
}

{ /* Config */
	logs.printHeader('Argos Server');
	config.useLogger(logs);

	config.require('port', [], 'What port shall the server use');
	config.require('host', [], 'What url/IP is the server connected to from');
	config.require('serverName', [], 'Please name this server');
	config.require('loggingLevel', {'A':'All', 'D':'Debug', 'W':'Warnings', 'E':'Errors'}, 'Set logging level');
	config.require('createLogFile', {true: 'Yes', false: 'No'}, 'Save logs to local file');
	config.require('warnTemp', [], 'Temperature to warn at');
	config.require('sendWarnEmails', {true: 'Yes', false: 'No'}, 'Send emails when warning temperatures are reached');
	{
		config.require('warnEmails', [], 'Comma seperated emails to send warnings to', ['sendWarnEmails', true]);
		config.require('emailHost', [], 'Host address for email account', ['sendWarnEmails', true]);
		config.require('emailPort', [], 'Port for email account', ['sendWarnEmails', true]);
		config.require('emailSecure', {true: 'Yes', false: 'No'}, 'Use secure SSL for email', ['sendWarnEmails', true]);
		config.require('emailUser', [], 'Email account username', ['sendWarnEmails', true]);
		config.require('emailPass', [], 'Email account password', ['sendWarnEmails', true]);
		config.require('emailFrom', [], 'Email address to send from', ['sendWarnEmails', true]);
	}
	config.require('useDb', {true: 'Yes', false: 'No'}, 'Save data to database');
	{
		config.require('dbUser', [], 'Database username', ['useDb', true]);
		config.require('dbPass', [], 'Database password', ['useDb', true]);
		config.require('dbDatabase', [], 'Database name', ['useDb', true]);
		config.require('dbHost', [], 'Database host address', ['useDb', true]);
	}
	config.require('advancedMode', {true: 'Yes', false: 'No'}, 'Show advanced config options?');
	{
		config.require('debugLineNum', {true: 'Yes', false: 'No'}, 'Show line numbers in logs', ['advancedMode', true]);
		config.require('printPings', {true: 'Yes', false: 'No'}, 'Print ping messages', ['advancedMode', true]);
		config.require('secureWS', {true: 'WSS', false: 'WS'}, 'Use WSS or WS', ['advancedMode', true]);
	}

	config.default('port', 8080);
	config.default('host', 'localhost');
	config.default('serverName', 'Argos Server');
	config.default('loggingLevel', 'W');
	config.default('createLogFile', true);
	config.default('debugLineNum', false);
	config.default('printPings', false);
	config.default('warnTemp', 35);
	config.default('sendWarnEmails', false);
	config.default('warnEmails', '');
	config.default('useDb', true);
	config.default('dbUser', 'argos');
	config.default('dbDatabase', 'argos');
	config.default('dbHost', 'localhost');
	config.default('advancedMode', false);
	config.default('secureWS', true);

	if (!await config.fromFile(__dirname + '/config.conf')) {
		await config.fromCLI(__dirname + '/config.conf');
	}

	logs.setConf({
		'createLogFile': config.get('createLogFile'),
		'logsFileName': 'ArgosLogging',
		'configLocation': __dirname,
		'loggingLevel': config.get('loggingLevel'),
		'debugLineNum': config.get('debugLineNum'),
	});

	log('Running version: v'+version, ['H', 'SERVER', logs.g]);

	config.print();
	config.userInput(async (command)=>{
		switch (command) {
		case 'config':
			await config.fromCLI(__dirname + '/config.conf');
			logs.setConf({
				'createLogFile': config.get('createLogFile'),
				'logsFileName': 'ArgosLogging',
				'configLocation': __dirname,
				'loggingLevel': config.get('loggingLevel'),
				'debugLineNum': config.get('debugLineNum')
			});
			SQL.init();
			return true;
		}
	});
}

const transporter = nodemailer.createTransport({
	'host': config.get('emailHost'),
	'port': config.get('emailPort'),
	'secure': config.get('emailSecure'),
	'auth': {
		'user': config.get('emailUser'),
		'pass': config.get('emailPass')
	}
});

const SQL = config.get('useDb') ? new SQLSession : false;
if (!SQL) {
	log(`Running ${logs.y}without${logs.w} database connection, this means Argos will not record any data`, 'C');
} else {
	log(`Running ${logs.y}with${logs.w} database connection`, 'C');
}

const [serverHTTP, serverWS] = startServers();
startLoops();


/* Server functions */

function startServers() {
	const expressApp = express();
	const serverWS = new WebSocketServer({noServer: true});
	const serverHTTP = http.createServer(expressApp);

	setupExpress(expressApp);

	serverHTTP.listen(config.get('port'));
	log(`Argos can be accessed at http://localhost:${config.get('port')}`, 'C');

	serverHTTP.on('upgrade', (request, socket, head) => {
		log('Upgrade request received', 'D');
		serverWS.handleUpgrade(request, socket, head, socket => {
			serverWS.emit('connection', socket, request);
		});
	});

	// Main websocket server functionality
	serverWS.on('connection', function connection(socket) {
		log('New connection established', 'D');

		socket.pingStatus = 'alive';

		socket.on('message', function message(msgJSON) {
			let msgObj = {};
			let pObj;
			let hObj;
			try {
				msgObj = JSON.parse(msgJSON);
				if (msgObj.payload.command !== 'ping' && msgObj.payload.command !== 'pong') {
					logObj('Received', msgObj, 'A');
				} else if (config.get('printPings') == true) {
					logObj('Received', msgObj, 'A');
				}
				pObj = msgObj.payload;
				hObj = msgObj.header;
				if (typeof pObj.source == 'undefined') {
					pObj.source = 'default';
				}
				switch (pObj.command) {
				case 'meta':
					log('Received: '+msgJSON, 'D');
					socket.send('Received meta');
					break;
				case 'register':
					coreDoRegister(socket, msgObj);
					break;
				case 'disconnect':
					log(`${logs.r}${pObj.data.ID}${logs.reset} Connection closed`, 'D');
					break;
				case 'pong':
					socket.pingStatus = 'alive';
					break;
				case 'ping':
					socket.pingStatus = 'alive';
					sendData(socket, {'command': 'pong'});
					break;
				case 'error':
					log(`Device ${hObj.fromID} has entered an error state`, 'E');
					log(`Message: ${pObj.error}`, 'E');
					break;
				case 'log':
					handleLog(hObj, pObj);
					break;
				case 'get':
					handleGet(socket, hObj, pObj);
					break;
				default:
					logObj('Unknown message', msgObj, 'W');
				}
			} catch (e) {
				try {
					msgObj = JSON.parse(msgJSON);
					if (msgObj.payload.command !== 'ping' && msgObj.payload.command !== 'pong') {
						logObj('Received', msgObj, 'A');
					} else if (config.get('printPings') == true) {
						logObj('Received', msgObj, 'A');
					}
					if (typeof msgObj.type == 'undefined') {
						let stack = e.stack.toString().split(/\r\n|\n/);
						stack = JSON.stringify(stack, null, 4);
						log(`Server error, stack trace: ${stack}`, 'E');
					} else {
						log('A device is using old tally format, upgrade it to v4.0 or above', 'E');
					}
				} catch (e2) {
					log('Invalid JSON - '+e, 'E');
					log('Received: '+msgJSON, 'A');
				}
			}
		});

		socket.on('close', function() {
			try {
				let oldId = JSON.parse(JSON.stringify(socket.ID));
				log(`${logs.r}${oldId}${logs.reset} Connection closed`, 'D');
				socket.connected = false;
			} catch (e) {
				log('Could not end connection cleanly','E');
			}
		});
	});

	serverWS.on('error', function() {
		log('Server failed to start or crashed, please check the port is not in use', 'E');
		process.exit(1);
	});

	return [serverHTTP, serverWS];
}

function setupExpress(expressApp) {
	expressApp.set('views', __dirname + '/views');
	expressApp.set('view engine', 'ejs');
	expressApp.use(cors());
	expressApp.use(express.static('public'));

	expressApp.get('/', async function(request, response) {
		handleRoot(request, response);
	});
}

/* Loops & Pings */

function startLoops() {

	// 5 Second ping loop
	setInterval(() => {
		doPing();
	}, 5*1000);

	// 30 Second ping loop
	setInterval(() => {
		checkPing();}
	, 30*1000);

	// 5 Minute ping loop
	/*setInterval(() => {

	}, 60*1000*5);*/
}

function doPing() {
	if (config.get('printPings') !== false) {
		log('Doing ping', 'A');
	}
	let counts = {};
	counts.alive = 0;
	counts.dead = 0;
	serverWS.clients.forEach(function each(client) {
		if (client.readyState === 1) {
			if (client.pingStatus == 'alive') {
				counts.alive++;
				let payload = {};
				payload.command = 'ping';
				sendData(client, payload);
				client.pingStatus = 'pending';
			} else if (client.pingStatus == 'pending') {
				client.pingStatus = 'dead';
			} else {
				counts.dead++;
			}
		}
	});
	if (config.get('printPings') !== false) {
		log('Clients alive: '+counts.alive, 'A');
		log('Clients dead: '+counts.dead, 'A');
	}
}

function resetPings(system) {
	let systems = pingList.map((item) => {return item?.name;});
	let index = systems.indexOf(system);
	pingList[index].latePing = false;
	pingList[index].latePings = 0;
}

function checkPing() {
	pingList.forEach(async system => {
		const sysConfig = await systemConfig(system.name);
		if (system.latePing && (sysConfig.warnPing)) {
			doLatePing(system);
		} else {
			system.latePing = true;
			system.latePings = 0;
		}
	});
}

async function doLatePing(system) {
	system.latePings++;

	if (system.latePings > 1080) {
		if (system.latePings % 2160 == 0) {
			pingAlert('W', system.latePings/360, 'hours', system.name);
		}
	} else if (system.latePings > 359) {
		if (system.latePings % 360 == 0) {
			pingAlert('W', system.latePings/360, 'hours', system.name);
		}
	} else if (system.latePings > 31) {
		if (system.latePings % 60 == 0) {
			pingAlert('W', system.latePings/6, 'minutes', system.name);
		}
	} else if (system.latePings > 5) {
		if (system.latePings % 6 == 0) {
			pingAlert('W', system.latePings/6, 'minutes', system.name);
		}
	}
	
	await SQL.insert({'Type':'Ping', 'Status':0, 'System':system.name}, 'status');
	
	sendClients(makePacket({
		'command':'data',
		'data':'ping',
		'status':0,
		'system': system.name,
		'time': new Date().getTime()
	}));
	log(`${system.name} missed ${system.latePings} pings`, 'W');
}

/* Core functions & Message handeling */

function coreDoRegister(socket, msgObj) {
	let hObj = msgObj.header;
	let pObj = msgObj.payload;
	if (typeof socket.type == 'undefined') {
		socket.type = hObj.type;
	}
	if (typeof socket.ID == 'undefined') {
		socket.ID = hObj.fromID;
	}
	if (typeof socket.version == 'undefined') {
		socket.version = hObj.version;
	}
	if (typeof socket.prodID == 'undefined') {
		socket.prodID = hObj.prodID;
	}
	if (hObj.version !== version) {
		if (hObj.version.substr(0, hObj.version.indexOf('.')) != version.substr(0, version.indexOf('.'))) {
			log('Connected client has different major version, it will not work with this server!', 'E');
		} else {
			log('Connected client has differnet version, support not guaranteed', 'W');
		}
	}
	log(`${logs.g}${hObj.fromID}${logs.reset} Registered as new client`, 'D');
	socket.connected = true;
	if (typeof pObj.data !== 'undefined') {
		if (typeof pObj.data.camera !== 'undefined') {
			socket.camera = pObj.data.camera;
		}
	}
}

function sendClients(json, socket = null) { //All but servers
	let obj = {};
	if (typeof json == 'object') {
		obj = json;
	} else {
		obj = JSON.parse(json);
	}

	const recipients = obj.header.recipients;
	serverWS.clients.forEach(function each(client) {
		if (client !== socket && client.readyState === WebSocket.OPEN) {
			if (!recipients.includes(client.address) && client.type != 'Server') {
				client.send(JSON.stringify(obj));
			}
		}
	});
}

/* Websocket packet functions */

function makeHeader(intType = type, intVersion = version) {
	let header = {};
	header.fromID = serverID;
	header.timestamp = new Date().getTime();
	header.version = intVersion;
	header.type = intType;
	header.active = true;
	header.messageID = header.timestamp;
	header.recipients = [
		config.get('host')
	];
	return header;
}

function makePacket(json) {
	let payload = {};
	if (typeof json == 'object') {
		payload = json;
	} else {
		payload = JSON.parse(json);
	}
	let packet = {};
	let header = makeHeader();
	packet.header = header;
	packet.payload = payload;
	return packet;
}

function sendData(connection, payload) {
	let packet = {};
	let header = makeHeader();
	packet.header = header;
	packet.payload = payload;
	connection.send(JSON.stringify(packet));
}

/* Handelers */

function handleLog(header, payload) {
	switch (payload.type) {
	case 'ping':
		handlePing(header.system);
		break;
	case 'boot':
		handleBoot(header.system);
		break;
	case 'temperature':
		handleTemps(header.system, payload);
		break;
	}
}

function handleGet(socket, header, payload) {
	switch (payload.data) {
	case 'temperature':
		getTemperature(socket, header, payload);
		break;
	case 'ping':
		getPings(socket, header, payload);
		break;
	default:

	}
}

async function handleRoot(request, response) {
	log('Serving index page', 'A');
	response.header('Content-type', 'text/html');
	

	const systemsRows = await SQL.query('SELECT `System` AS \'Name\' FROM `status` GROUP BY `System`;');
	const systems = typeof systemsRows === 'undefined' ? [] : systemsRows.map(row => row.Name);

	const pingRows = await SQL.query('SELECT * FROM `status` WHERE `Type`=\'Ping\' AND `Status` = 1 ORDER BY `PK` DESC LIMIT 1;');
	const ping = typeof pingRows === 'undefined' ? [] : [pingRows];

	const pingsRows = await SQL.query('SELECT * FROM `status` WHERE `Type`=\'Ping\' AND `PK` mod 10 = 0 ORDER BY `PK` DESC LIMIT 144;');
	const pings = {};
	if (typeof pingRows !== 'undefined') {
		pingsRows.forEach(row => {
			pings[row.Time] = row.Status;
		});
	}

	const bootRows = await SQL.query('SELECT * FROM `status` WHERE `Type`=\'Boot\' ORDER BY `PK` DESC;');
	const boot = typeof bootRows === 'undefined' ? [] : [bootRows];
	const boots = {};
	if (typeof bootRows !== 'undefined') {
		bootRows.forEach(row => {
			boots[row.Time] = 1;
		});
	}

	
	response.render('index', {
		host: config.get('host'),
		serverName: config.get('serverName'),
		pings: pings,
		ping: ping,
		boots: boots,
		boot: boot,
		systems: systems.filter(Boolean),
		version: version,
		secureWS: config.get('secureWS')
	});
}

async function handlePing(system) {
	log('Recieved a ping', 'D');
	const systems = pingList.map((item) => {return item?.name;});
	if (!systems.includes(system)) {
		const sysConfig = await systemConfig(system);
		if (typeof sysConfig == 'undefined') {
			
			SQL.insert({
				'warnPing': config.get('sendWarnEmails'),
				'warnTemp': config.get('sendWarnEmails'),
				'warnBoot': config.get('sendWarnEmails'),
				'warnDev': config.get('sendWarnEmails'),
				'warnFlap': config.get('sendWarnEmails'),
				'warnPhy': config.get('sendWarnEmails'),
				'warnUPS': config.get('sendWarnEmails'),
				'warnFibre': config.get('sendWarnEmails'),
				'warnEmails': config.get('warnEmails'),
				'System': system
			}, 'config').then(()=>{});
		}
		pingList.push({
			name: system,
			latePing: false,
			latePings: 0
		});
	}
	resetPings(system);
	
	await SQL.insert({'Type':'Ping', 'Status':1, 'System':system}, 'status');
	
	sendClients(makePacket({
		'command':'data',
		'data':'ping',
		'status':1,
		'system': system,
		'time': new Date().getTime()
	}));
	log('Recorded Ping', 'D');
}

function handleBoot(system) {
	log('Recieved a boot', 'D');
	bootAlert('W', system);
	
	SQL.insert({'Type':'Boot', 'Status':1, 'System':system}, 'status').then(()=>{
		
		sendClients(makePacket({
			'command':'data',
			'data':'boot',
			'time': new Date().getTime()
		}));
		log('Recorded boot', 'D');
	});
}

function handleTemps(system, payload) {
	log('Recieved some temps', 'D');

	
	const promises = [];
	let average = 0;
	const timeStamp = new Date().getTime();
	const dataObj = {
		'command':'data',
		'data':'temps',
		'system':system,
		'replace': false,
		'points':{}
	};
	dataObj.points[timeStamp] = {};

	payload.data.forEach((frame) => {

		if (typeof frame.Temp !== 'undefined') {
			average += frame.Temp;
			if (frame.Temp > config.get('warnTemp')) {
				tempAlert('W', frame.Name, frame.Temp, system);
			}
			dataObj.points[timeStamp][frame.Name] = frame.Temp;
			promises.push(SQL.insert({
				'frame': frame.Name,
				'temperature': frame.Temp,
				'system': system
			}, 'temperature'));
		}
	});

	average = average/promises.length;
	dataObj.points[timeStamp].average = average;

	Promise.allSettled(promises).then(() => {
		
	});

	sendClients(makePacket(dataObj));
}

async function getPings(socket, header, payload) {
	log(`Getting pings for ${header.system}`, 'D');
	const from = Number(payload.from);
	const to = Number(payload.to);
	
	const countRows = await SQL.query(`SELECT count(\`PK\`) AS 'total' FROM \`status\` WHERE time BETWEEN FROM_UNIXTIME(${from}) AND FROM_UNIXTIME(${to}) AND \`system\` = '${header.system}' ORDER BY \`PK\` ASC; `);
	const total = typeof countRows[0].total == 'number' ? countRows[0].total : 0;
	const divisor = Math.ceil(total/1000);
	const pingRows = await SQL.query(`SELECT * FROM \`status\` WHERE (\`Type\`='Ping' AND MOD(\`PK\`, ${divisor}) = 0 OR \`Status\`='0') AND Time BETWEEN FROM_UNIXTIME(${from}) AND FROM_UNIXTIME(${to}) AND \`system\` = '${header.system}' ORDER BY \`PK\` ASC; `);
	let pings = {};
	pingRows.forEach((row) => {
		pings[row.Time] = row.Status;
	});

	socket.send(JSON.stringify(makePacket({
		'command': 'data',
		'data': 'ping',
		'replace': true,
		'system': header.system,
		'points': pings
	})));
}

async function getTemperature(socket, header, payload) {
	log(`Getting temperatures for ${header.system}`, 'D');
	const from = Number(payload.from);
	const to = Number(payload.to);
	
	const dateRows = await SQL.query(`SELECT ROW_NUMBER() OVER (ORDER BY PK) AS Number, \`PK\`, \`time\` FROM \`temperature\` WHERE time BETWEEN FROM_UNIXTIME(${from}) AND FROM_UNIXTIME(${to}) AND \`system\` = '${header.system}' GROUP BY \`time\`; `);
	const total = typeof dateRows.length == 'number' ? dateRows.length : 0;
	const divisor = Math.ceil(total/1000);
	const whereArr = dateRows.map((a)=>{
		if (a.Number % divisor == 0) {
			let data = new Date(a.time).toISOString().slice(0, 19).replace('T', ' ');
			return `'${data}'`;
		}
	}).filter(Boolean);
	const whereString = whereArr.join(',');
	let query;
	if (whereString == '') {
		query = `SELECT * FROM \`temperature\` WHERE \`system\` = '${header.system}' ORDER BY \`PK\` ASC LIMIT 1; `;
	} else {
		query = `SELECT * FROM \`temperature\` WHERE time IN (${whereString}) AND \`system\` = '${header.system}' ORDER BY \`PK\` ASC; `;
	}

	const tempRows = await SQL.query(query);
	const points = {};

	tempRows.forEach(row => {
		let timestamp = row.time.getTime();
		if (!points[timestamp]) {
			points[timestamp] = {};
		}
		let point = points[timestamp];
		point[row.frame] = row.temperature;

		delete point.average;
		const n = Object.keys(point).length;
		const values = Object.values(point);
		const total = values.reduce((accumulator, value) => {
			return accumulator + value;
		}, 0);
		point.average = total/n;
	});

	socket.send(JSON.stringify(makePacket({
		'command':'data',
		'data':'temps',
		'system':header.system,
		'replace': true,
		'points': points
	})));
}

/* Config */

async function systemConfig(system) {
	
	const [systemConfig] = await SQL.query(`SELECT * FROM \`config\` WHERE \`system\` = '${system}'; `);
	return systemConfig;
}

/* Alerts */

async function tempAlert(level, text, temp, system) {
	const sysConfig = await systemConfig(system);
	transporter.sendMail({
		from: `"${system} Temp Alerts" <${config.get('emailFrom')}>`,
		to: sysConfig.warnEmails,
		subject: `${system} Temperature Alert`,
		text: `The ${text} temperature is at a critical level! Current temperature is: ${temp}°C`
	});
	log(`The ${text} temperature in ${system} is at a critical level! Current temperature is: ${temp}°C, emailing: ${sysConfig.warnEmails}`, level);
}

async function pingAlert(level, time, interval, system) {
	const sysConfig = await systemConfig(system);
	transporter.sendMail({
		from: `"${system} Ping Alerts" <${config.get('emailFrom')}>`,
		to: sysConfig.warnEmails,
		subject: `${system} Ping Alert`,
		text: `The ${system} Vision PC has not pinged the server in ${time} ${interval}. It is either offline or has lost internet`
	});
	log(`The ${system} Vision PC has not pinged the server in ${time} ${interval}. It is either offline or has lost internet, emailing: ${sysConfig.warnEmails}`, level);
}

async function bootAlert(level, system) {
	const sysConfig = await systemConfig(system);
	transporter.sendMail({
		from: `"${system} Boot Alerts" <${config.get('emailFrom')}>`,
		to: sysConfig.warnEmails,
		subject: `${system} Boot Alert`,
		text: `The ${system} Vision PC has just booted`
	});
	log(`The ${system} Vision PC has just booted, emailing: ${sysConfig.warnEmails}`, level);
}