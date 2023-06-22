#!/usr/bin/env nodeSQL
/*jshint esversion: 6 */
const serverID = new Date().getTime();

import { WebSocket } from 'ws';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import cors from 'cors';
import express from 'express';
import {log, logObj, logs} from 'xeue-logs';
import {config} from 'xeue-config';
import {SQLSession} from 'xeue-sql';
import {Server} from 'xeue-webserver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer');

const {version} = require('./package.json');
const type = 'Server';
const pingList = [];
let SQL = false;

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
			SQL.init(tables);
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

const tables = [
	{
		name: 'temperature',
		definition: `CREATE TABLE \`temperature\` (
			\`PK\` int(11) NOT NULL,
			\`Frame\` text NOT NULL,
			\`Temperature\` float NOT NULL,
			\`System\` text NOT NULL,
			\`Time\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE current_timestamp(),
			PRIMARY KEY (\`PK\`)
		) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
		PK:'PK'
	},
	
	{
		name: 'status',
		definition: `CREATE TABLE \`status\` (
			\`PK\` int(11) NOT NULL,
			\`Type\` varchar(255) NOT NULL,
			\`Status\` tinyint(1) NOT NULL,
			\`Time\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE current_timestamp(), 
			\`System\` varchar(256) DEFAULT NULL,
			PRIMARY KEY (\`PK\`)
		) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
		PK:'PK'
	},
	
	{
		name: 'config',
		definition: `CREATE TABLE \`config\` (
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
			\`Time\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE current_timestamp(),
			\`System\` varchar(256) DEFAULT NULL,
			PRIMARY KEY (\`PK\`)
		) ENGINE=InnoDB DEFAULT CHARSET=latin1`,
		PK:'PK'
	}
];

if (config.get('useDb')) {
	SQL = new SQLSession(
		config.get('dbHost'),
		config.get('dbPort'),
		config.get('dbUser'), 
		config.get('dbPass'), 
		config.get('dbDatabase'),
		logs
	);
	await SQL.init(tables);
}


if (SQL) {
	log(`Running ${logs.y}with${logs.w} database connection`, 'C');
} else {
	log(`Running ${logs.y}without${logs.w} database connection, this means Argos will not record any data`, 'C');
}


const webServer = new Server(
	config.get("port"),
	expressRoutes,
	logs,
	version,
	config,
	doMessage
);
const [serverHTTP, serverWS] = webServer.start();
log(`Argos can be accessed at http://localhost:${config.get('port')}`, 'C');

startLoops();

/* Server functions */

async function doMessage(msgObj, socket) {
	const pObj = msgObj.payload;
	const hObj = msgObj.header;
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
		webServer.sendTo(client, {'command': 'pong'});
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
}

function expressRoutes(expressApp) {
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
				webServer.sendTo(client, payload);
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
			pingAlert(system.latePings/360, 'hours', system.name);
		}
	} else if (system.latePings > 359) {
		if (system.latePings % 360 == 0) {
			pingAlert(system.latePings/360, 'hours', system.name);
		}
	} else if (system.latePings > 31) {
		if (system.latePings % 60 == 0) {
			pingAlert(system.latePings/6, 'minutes', system.name);
		}
	} else if (system.latePings > 5) {
		if (system.latePings % 6 == 0) {
			pingAlert(system.latePings/6, 'minutes', system.name);
		}
	}
	
	const [previous, secondPrevious] = await SQL.getN({'System':system.name, 'Type':'Ping'},'Time', 2,'status');
	if (previous?.Status == 0 && secondPrevious?.Status == 0) {
		await SQL.updateTime('Time', {'PK': previous.PK}, 'status');
	} else {
		await SQL.insert({'Type':'Ping', 'Status':0, 'System':system.name}, 'status');
	}
	
	webServer.sendToAll({
		'command':'data',
		'data':'ping',
		'status':0,
		'system': system.name,
		'time': new Date().getTime()
	})
	log(`${system.name} missed ${system.latePings} pings`, 'A');
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
	case 'boot':
		getBoots(socket, header, payload);
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
	log(`Recieved a ping from: ${logs.y}${system}${logs.reset}`, 'D');
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
	
	const [previous, secondPrevious] = await SQL.getN({'System':system, 'Type':'Ping'},'Time', 2,'status');
	if (previous?.Status == 1 && secondPrevious?.Status == 1) {
		await SQL.updateTime('Time', {'PK': previous.PK}, 'status');
	} else {
		await SQL.insert({'Type':'Ping', 'Status':1, 'System':system}, 'status');
	}
	
	webServer.sendToAll({
		'command':'data',
		'data':'ping',
		'status':1,
		'system': system,
		'time': new Date().getTime()
	})
}

async function handleBoot(system) {
	log(`Recieved a boot notification from: ${logs.y}${system}${logs.reset}`, 'D');
	bootAlert(system);
	
	await SQL.insert({'Type':'Boot', 'Status':1, 'System':system}, 'status');
		
	webServer.sendToAll({
		'command':'data',
		'data':'boot',
		'status':1,
		'system': system,
		'time': new Date().getTime()
	})
}

function handleTemps(system, payload) {
	log(`Recieved some temperatures from: ${logs.y}${system}${logs.reset}`, 'D');

	let average = 0;
	let averageCounter = 0;
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
			averageCounter++;
			average += frame.Temp;
			if (frame.Temp > config.get('warnTemp')) {
				tempAlert(frame.Name, frame.Temp, system);
			}
			dataObj.points[timeStamp][frame.Name] = frame.Temp;
			SQL.insert({
				'Frame': frame.Name,
				'Temperature': frame.Temp,
				'System': system
			}, 'temperature');
		}
	});

	average = average/averageCounter;
	dataObj.points[timeStamp].average = average;

	webServer.sendToAll(dataObj);
}

async function getPings(socket, header, payload) {
	log(`Getting pings for ${header.system}`, 'D');
	const from = Number(payload.from);
	const to = Number(payload.to);
	
	const countRows = await SQL.query(`SELECT count(\`PK\`) AS 'total' FROM \`status\` WHERE \`Type\`='Ping' AND time BETWEEN FROM_UNIXTIME(${from}) AND FROM_UNIXTIME(${to}) AND \`system\` = '${header.system}' ORDER BY \`PK\` ASC; `);
	const total = Number(countRows[0].total);
	let divisor = 1;
	if (total > 50) {
		divisor = isNaN(total) ? 1 : Math.ceil(total/1000);
	}
	let pingRows = await SQL.query(`SELECT * FROM \`status\` WHERE (\`Type\`='Ping' AND MOD(\`PK\`, ${divisor}) = 0 OR \`Status\`='0') AND Time BETWEEN FROM_UNIXTIME(${from}) AND FROM_UNIXTIME(${to}) AND \`system\` = '${header.system}' ORDER BY \`PK\` ASC; `);
	if (pingRows.length < 4) {
		pingRows = await SQL.query(`SELECT * FROM \`status\` WHERE (\`Type\`='Ping' AND \`system\` = '${header.system}') ORDER BY \`PK\` ASC LIMIT 4; `);
	}
	let pings = {};
	pingRows.forEach((row) => {
		pings[row.Time] = row.Status;
	});

	webServer.sendTo(socket, {
		'command': 'data',
		'data': 'ping',
		'replace': true,
		'system': header.system,
		'points': pings
	});
}

async function getTemperature(socket, header, payload) {
	log(`Getting temperatures for ${header.system}`, 'D');
	const from = Number(payload.from);
	const to = Number(payload.to);
	
	const dateRows = await SQL.query(`SELECT ROW_NUMBER() OVER (ORDER BY PK) AS Number, \`PK\`, \`Time\` FROM \`temperature\` WHERE time BETWEEN FROM_UNIXTIME(${from}) AND FROM_UNIXTIME(${to}) AND \`system\` = '${header.system}' GROUP BY \`Time\`; `);
	const total = typeof dateRows.length == 'number' ? dateRows.length : 0;
	if (total == 0) {
		webServer.sendTo(socket, {
			'command':'data',
			'data':'temps',
			'system':header.system,
			'replace': true,
			'points': {}
		});
		return;
	}
	const divisor = Math.ceil(total/1000);
	const whereArr = dateRows.map((a)=>{
		if (Number(a.Number) % divisor == 0) {
			let data = new Date(a.Time).toISOString().slice(0, 19).replace('T', ' ');
			return `'${data}'`;
		}
	}).filter(Boolean);
	const whereString = whereArr.join(',');
	let query;
	if (whereString == '') {
		query = `SELECT * FROM \`temperature\` WHERE \`system\` = '${header.system}' ORDER BY \`PK\` ASC LIMIT 1; `;
	} else {
		query = `SELECT * FROM \`temperature\` WHERE time IN (${whereString}) AND \`System\` = '${header.system}' ORDER BY \`PK\` ASC; `;
	}

	const tempRows = await SQL.query(query);
	const points = {};

	tempRows.forEach(row => {
		const timestamp = row.Time.getTime();
		if (!points[timestamp]) {
			points[timestamp] = {};
		}
		const point = points[timestamp];
		point[row.Frame] = row.Temperature;

		delete point.average;
		const n = Object.keys(point).length;
		const values = Object.values(point);
		const total = values.reduce((accumulator, value) => {
			return accumulator + value;
		}, 0);
		point.average = total/n;
	});

	webServer.sendTo(socket, {
		'command':'data',
		'data':'temps',
		'system':header.system,
		'replace': true,
		'points': points
	});
}

async function getBoots(socket, header, payload) {
	log(`Getting boots for ${header.system}`, 'D');
	const from = Number(payload.from);
	const to = Number(payload.to);
	
	let bootRows = await SQL.query(`SELECT * FROM \`status\` WHERE \`Type\`='Boot' AND Time BETWEEN FROM_UNIXTIME(${from}) AND FROM_UNIXTIME(${to}) AND \`system\` = '${header.system}' ORDER BY \`PK\` ASC; `);
	if (bootRows.length < 1) {
		bootRows = await SQL.query(`SELECT * FROM \`status\` WHERE \`Type\`='Boot' AND \`system\` = '${header.system}' ORDER BY \`PK\` ASC LIMIT 1; `);
	}
	let boots = {};
	bootRows.forEach((row) => {
		boots[row.Time] = row.Status;
	});

	webServer.sendTo(socket, {
		'command': 'data',
		'data': 'boot',
		'replace': true,
		'system': header.system,
		'points': boots
	});
}

/* Config */

async function systemConfig(system) {
	const [systemConfig] = await SQL.query(`SELECT * FROM \`config\` WHERE \`system\` = '${system}'; `);
	return systemConfig;
}

/* Alerts */

async function tempAlert(text, temp, system) {
	if (!config.get('sendWarnEmails')) return;
	const sysConfig = await systemConfig(system);
	if (!sysConfig.warnTemp) return;
	transporter.sendMail({
		from: `"${system} Temp Alerts" <${config.get('emailFrom')}>`,
		to: sysConfig.warnEmails,
		subject: `${system} Temperature Alert`,
		text: `The ${text} temperature in ${system} is at a critical level! Current temperature is: ${temp}°C`
	});
	log(`${system} - ${text} has exceeded the warning temperature and is at: ${temp}°C, emailing: ${sysConfig.warnEmails}`, 'W');
}

async function pingAlert(time, interval, system) {
	log(`The ${system} Argos system has not pinged the server in ${time} ${interval}`, 'W');
	if (!config.get('sendWarnEmails')) return;
	const sysConfig = await systemConfig(system);
	if (!sysConfig.warnPing) return;
	log(`Email ping alerts are enabled for ${system}, emailing: ${sysConfig.warnEmails}`, 'W');
	transporter.sendMail({
		from: `"${system} Ping Alerts" <${config.get('emailFrom')}>`,
		to: sysConfig.warnEmails,
		subject: `${system} Ping Alert`,
		text: `The ${system} Argos system has not pinged the server in ${time} ${interval}. It is either offline or has lost internet`
	});
}

async function bootAlert(system) {
	if (!config.get('sendWarnEmails')) return;
	const sysConfig = await systemConfig(system);
	if (!sysConfig.warnBoot) return;
	transporter.sendMail({
		from: `"${system} Boot Alerts" <${config.get('emailFrom')}>`,
		to: sysConfig.warnEmails,
		subject: `${system} Boot Alert`,
		text: `The ${system} Argos system has just booted`
	});
	log(`The ${system} Argos system has just started, emailing: ${sysConfig.warnEmails}`, 'W');
}