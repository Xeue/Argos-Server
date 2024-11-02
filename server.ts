#!/usr/bin/env nodeSQL
/*jshint esversion: 6 */
const serverID = new Date().getTime();

import { createRequire } from 'module';
import path from 'path';
import cors from 'cors';
import express from 'express';
import {Logs as _Logs} from 'xeue-logs';
import {Config as _Config} from 'xeue-config';
import {SQLSession as _SQL, SQLSession} from 'xeue-sql';
import {Server as _Server, message, header, payload, socket} from 'xeue-webserver';
import Package from './package.json' with {type: "json"};


const __internal = import.meta.dirname;
const __data = path.join(__internal, '/data');
const __static = path.join(__internal, '/static');
const __views = path.join(__internal, '/views');

const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer');

const version = Package.version;

type system = {
	name: string,
	latePing: boolean,
	latePings: number
}

const pingList: system[] = [];

let SQL: SQLSession;

const Logs = new _Logs(true, "ArgosLogging", __data, 'D', false)
const Config = new _Config(
	Logs
);
const Server = new _Server(
	expressRoutes,
	Logs,
	version,
	Config,
	doMessage
);

const tables = [
	{
		name: 'temperature',
		definition: `CREATE TABLE \`temperature\` (
			\`PK\` int(11) NOT NULL,
			\`Frame\` text NOT NULL,
			\`Temperature\` float NOT NULL,
			\`System\` text NOT NULL,
			\`Type\` text NOT NULL,
			\`Time\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP(),
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

{ /* Config */
	Logs.printHeader('Argos Server');

	Config.require('port', [], 'What port shall the server use');
	Config.require('host', [], 'What url/IP is the server connected to from');
	Config.require('serverName', [], 'Please name this server');
	Config.require('loggingLevel', {'A':'All', 'D':'Debug', 'W':'Warnings', 'E':'Errors'}, 'Set logging level');
	Config.require('createLogFile', {true: 'Yes', false: 'No'}, 'Save logs to local file');
	Config.require('warnTemp', [], 'Temperature to warn at');
	Config.require('sendWarnEmails', {true: 'Yes', false: 'No'}, 'Send emails when warning temperatures are reached');
	{
		Config.require('warnEmails', [], 'Comma seperated emails to send warnings to', ['sendWarnEmails', true]);
		Config.require('emailHost', [], 'Host address for email account', ['sendWarnEmails', true]);
		Config.require('emailPort', [], 'Port for email account', ['sendWarnEmails', true]);
		Config.require('emailSecure', {true: 'Yes', false: 'No'}, 'Use secure SSL for email', ['sendWarnEmails', true]);
		Config.require('emailUser', [], 'Email account username', ['sendWarnEmails', true]);
		Config.require('emailPass', [], 'Email account password', ['sendWarnEmails', true]);
		Config.require('emailFrom', [], 'Email address to send from', ['sendWarnEmails', true]);
	}
	Config.require('useDb', {true: 'Yes', false: 'No'}, 'Save data to database');
	{
		Config.require('dbUser', [], 'Database username', ['useDb', true]);
		Config.require('dbPass', [], 'Database password', ['useDb', true]);
		Config.require('dbDatabase', [], 'Database name', ['useDb', true]);
		Config.require('dbHost', [], 'Database host address', ['useDb', true]);
	}
	Config.require('advancedMode', {true: 'Yes', false: 'No'}, 'Show advanced config options?');
	{
		Config.require('debugLineNum', {true: 'Yes', false: 'No'}, 'Show line numbers in logs', ['advancedMode', true]);
		Config.require('printPings', {true: 'Yes', false: 'No'}, 'Print ping messages', ['advancedMode', true]);
		Config.require('secureWS', {true: 'WSS', false: 'WS'}, 'Use WSS or WS', ['advancedMode', true]);
	}

	Config.default('port', 8080);
	Config.default('host', 'localhost');
	Config.default('serverName', 'Argos Server');
	Config.default('loggingLevel', 'W');
	Config.default('createLogFile', true);
	Config.default('debugLineNum', false);
	Config.default('printPings', false);
	Config.default('warnTemp', 35);
	Config.default('sendWarnEmails', false);
	Config.default('warnEmails', '');
	Config.default('useDb', true);
	Config.default('dbUser', 'argos');
	Config.default('dbDatabase', 'argos');
	Config.default('dbHost', 'localhost');
	Config.default('advancedMode', false);
	Config.default('secureWS', true);

	if (!await Config.fromFile(path.join(__data, 'config.conf'))) {
		await Config.fromCLI(path.join(__data, 'config.conf'));
	}

	Logs.setConf({
		'createLogFile': Config.get('createLogFile'),
		'logsFileName': 'ArgosLogging',
		'configLocation': __data,
		'loggingLevel': Config.get('loggingLevel'),
		'debugLineNum': Config.get('debugLineNum'),
	});

	Logs.log('Running version: v'+version, ['H', 'SERVER', Logs.g]);

	Config.print();
	Config.userInput(async (command)=>{
		switch (command) {
		case 'config':
			await Config.fromCLI(__data + '/config.conf');
			Logs.setConf({
				'createLogFile': Config.get('createLogFile'),
				'logsFileName': 'ArgosLogging',
				'configLocation': __data,
				'loggingLevel': Config.get('loggingLevel'),
				'debugLineNum': Config.get('debugLineNum')
			});
			return true;
		}
	});

	if (Config.get('useDb')) {
		SQL = new _SQL(
			Config.get('dbHost'),
			Config.get('dbPort'),
			Config.get('dbUser'),
			Config.get('dbPass'),
			Config.get('dbDatabase'),
			Logs
		);
		await SQL.init(tables);
		const sensor = await SQL.query("SHOW COLUMNS FROM `temperature` LIKE 'frame';");
		if (sensor.length == 0) {
			await SQL.query("ALTER TABLE `temperature` RENAME COLUMN frame TO sensor;");
		}
		const sensorType = await SQL.query("SHOW COLUMNS FROM `temperature` LIKE 'sensorType';");
		if (sensorType.length == 0) {
			await SQL.query("ALTER TABLE `temperature` ADD COLUMN sensorType text NOT NULL;");
			await SQL.query("UPDATE `temperature` SET sensorType = 'IQ Frame' WHERE 1=1;");
		}
		Logs.log(`Running ${Logs.y}with${Logs.w} database connection`, 'C');
	} else {
		Logs.log(`Running ${Logs.y}without${Logs.w} database connection, this means Argos will not record any data`, 'C');
	}
}

const transporter = nodemailer.createTransport({
	'host': Config.get('emailHost'),
	'port': Config.get('emailPort'),
	'secure': Config.get('emailSecure'),
	'auth': {
		'user': Config.get('emailUser'),
		'pass': Config.get('emailPass')
	}
});

Server.start(Config.get('port'))
Logs.log(`Argos can be accessed at http://localhost:${Config.get('port')}`, 'C');

startLoops();

/* Server functions */

async function doMessage(message: message, socket: socket) {
	const payload = message.payload;
	const header = message.header;

	switch (payload.module) {
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
			switch (payload.command) {
				case 'meta':
					Logs.debug('Meta message', payload);
					socket.send('Received meta');
					break;
				case 'register':
					coreDoRegister(socket, header, payload);
					break;
				case 'log':
					handleLog(header, payload);
					break;
				default:
					Logs.warn('Unknown message', message);
				}
			break;
	}
}

function expressRoutes(expressApp) {
	expressApp.set('views', __views);
	expressApp.set('view engine', 'ejs');
	expressApp.use(cors());
	expressApp.use(express.static(__static));

	expressApp.get('/', async function(request, response) {
		handleRoot(request, response);
	});
}

/* Loops & Pings */

function startLoops() {
	setInterval(() => {
		checkPing();}
	, 30*1000);
}

function resetPings(system: string) {
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

async function doLatePing(system: system) {
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
	
	Server.sendToAll({
		'module': 'ping',
		'command':'add',
		'data': {
			'status':0,
			'system': system.name,
			'time': new Date().getTime()
		}
	})
	Logs.info(`${system.name} missed ${system.latePings} pings`);
}

/* Core functions & Message handeling */

function coreDoRegister(socket: any, header: header, payload: payload) {
	if (typeof socket.type == 'undefined') {
		socket.type = header.type;
	}
	if (typeof socket.ID == 'undefined') {
		socket.ID = header.fromID;
	}
	if (typeof socket.version == 'undefined') {
		socket.version = header.version;
	}
	if (typeof socket.prodID == 'undefined') {
		socket.prodID = header.prodID;
	}
	if (header.version !== version) {
		if (header.version.substr(0, header.version.indexOf('.')) != version.substr(0, version.indexOf('.'))) {
			Logs.error('Connected client has different major version, it will not work with this server!');
		} else {
			Logs.warn('Connected client has differnet version, support not guaranteed');
		}
	}
	Logs.debug(`${Logs.g}${header.fromID}${Logs.reset} Registered as new client`);
	socket.connected = true;
	if (typeof payload.data !== 'undefined') {
		if (typeof payload.data.camera !== 'undefined') {
			socket.camera = payload.data.camera;
		}
	}
}

/* Handelers */

function handleLog(header: header, payload: any) {
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
	case 'ups':
		handleUps(header.system, payload);
		break;
	}
}

async function handleRoot(request, response) {
	Logs.info('Serving index page');
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
		host: Config.get('host'),
		serverName: Config.get('serverName'),
		pings: pings,
		ping: ping,
		boots: boots,
		boot: boot,
		systems: systems.filter(Boolean),
		version: version,
		secureWS: Config.get('secureWS')
	});
}

async function handlePing(system: string) {
	Logs.debug(`Recieved a ping from: ${Logs.y}${system}${Logs.reset}`);
	const systems = pingList.map((item) => {return item?.name;});
	if (!systems.includes(system)) {
		const sysConfig = await systemConfig(system);
		if (typeof sysConfig == 'undefined') {
			
			SQL.insert({
				'warnPing': Config.get('sendWarnEmails'),
				'warnTemp': Config.get('sendWarnEmails'),
				'warnBoot': Config.get('sendWarnEmails'),
				'warnDev': Config.get('sendWarnEmails'),
				'warnFlap': Config.get('sendWarnEmails'),
				'warnPhy': Config.get('sendWarnEmails'),
				'warnUPS': Config.get('sendWarnEmails'),
				'warnFibre': Config.get('sendWarnEmails'),
				'warnEmails': Config.get('warnEmails'),
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
	
	Server.sendToAll({
		'module': 'ping',
		'command':'add',
		'data': {
			'status':1,
			'system': system,
			'time': new Date().getTime()
		}
	})
}

async function handleBoot(system: string) {
	Logs.debug(`Recieved a boot notification from: ${Logs.y}${system}${Logs.reset}`);
	bootAlert(system);
	
	await SQL.insert({'Type':'Boot', 'Status':1, 'System':system}, 'status');
		
	Server.sendToAll({
		'module': 'boot',
		'command':'add',
		'data': {
			'status':1,
			'system': system,
			'time': new Date().getTime()
		}
	})
}

function handleTemps(system: string, payload: payload) {
	Logs.debug(`Recieved some temperatures from: ${Logs.y}${system}${Logs.reset}`);

	let average = 0;
	let averageCounter = 0;
	const timeStamp = new Date().getTime();
	const sensorNames = Object.keys(payload.data);
	Logs.debug("Payload", payload);
	const type = payload.data[sensorNames[0]].Type == 'IQ Frame' ? 'iq' : 'generic';
	const dataObj = {
		'module': 'temperature',
		'command':'add',
		'data': {
			'type':type,
			'system':system,
			'points':{}
		}
	};
	dataObj.data.points[timeStamp] = {};

	if (sensorNames.length == 0) return;

	sensorNames.forEach(sensorName => {
		const sensor = payload.data[sensorName]
		if (typeof sensor.Temp !== 'undefined') {
			averageCounter++;
			average += sensor.Temp;
			if (sensor.Temp > Config.get('warnTemp')) {
				tempAlert(sensor.Name, sensor.Temp, system);
			}
			dataObj.data.points[timeStamp][sensor.Name] = sensor.Temp;
			const type = sensor.Type == 'IQ Frame' ? 'iq' : 'generic';
			SQL.insert({
				'Frame': sensor.Name,
				'Temperature': sensor.Temp,
				'Type': type,
				'System': system
			}, 'temperature');
		}
	});

	average = average/averageCounter;
	dataObj.data.points[timeStamp].average = average;

	Server.sendToAll(dataObj);
}

async function handleUps(system, payload) {

}

async function getPings(socket: socket, header: header, payload: payload) {
	Logs.debug(`Getting pings for ${header.system}`);
	const from = Number(payload.data.from);
	const to = Number(payload.data.to);
	
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

	Server.sendTo(socket, {
		'module': 'ping',
		'command': 'replace',
		'data': {
			'points': pings,
			'system': header.system
		}
	});
}

async function getTemperature(socket: socket, header: header, payload: payload) {
	Logs.debug(`Getting temperatures for ${header.system}`);
	const from = Number(payload.data.from);
	const to = Number(payload.data.to);
	
	const dateRows = await SQL.query(`SELECT ROW_NUMBER() OVER (ORDER BY PK) AS Number, \`PK\`, \`Time\` FROM \`temperature\` WHERE time BETWEEN FROM_UNIXTIME(${from}) AND FROM_UNIXTIME(${to}) AND \`System\` = '${header.system}' AND \`Type\` = '${payload.type}' GROUP BY \`Time\`; `);
	const total = typeof dateRows.length == 'number' ? dateRows.length : 0;
	if (total == 0) {
		Server.sendTo(socket, {
			'module': 'temperature',
			'command':'replace',
			'data': {
				'system':header.system,
				'type':payload.data.type,
				'points': {}
			}
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
		query = `SELECT * FROM \`temperature\` WHERE \`System\` = '${header.system}' AND \`Type\` = '${payload.type}' ORDER BY \`PK\` ASC LIMIT 1; `;
	} else {
		query = `SELECT * FROM \`temperature\` WHERE time IN (${whereString}) AND \`System\` = '${header.system}' AND \`Type\` = '${payload.type}' ORDER BY \`PK\` ASC; `;
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
		const values: number[] = Object.values(point);
		const total = values.reduce((accumulator, value) => {
			return accumulator + value;
		}, 0);
		point.average = total/n;
	});

	Server.sendTo(socket, {
		'module': 'temperature',
		'command':'replace',
		'data': {
			'system':header.system,
			'type':payload.type,
			'points': points
		}
	});
}

async function getBoots(socket: socket, header: header, payload: payload) {
	Logs.debug(`Getting boots for ${header.system}`);
	const from = Number(payload.data.from);
	const to = Number(payload.data.to);
	try {
		if (isNaN(from) || isNaN(to)) {
			Logs.debug("Message", [from, to, isNaN(from), isNaN(to)])
			Logs.error("Invalid range", payload);
			throw new Error("Invalid range");
		}
		let bootRows: any = await SQL.query(`SELECT * FROM \`status\` WHERE \`Type\`='Boot' AND Time BETWEEN FROM_UNIXTIME(${from}) AND FROM_UNIXTIME(${to}) AND \`system\` = '${header.system}' ORDER BY \`PK\` ASC; `);
		if (typeof bootRows.length != "undefined") {
			bootRows = await SQL.query(`SELECT * FROM \`status\` WHERE \`Type\`='Boot' AND \`system\` = '${header.system}' ORDER BY \`PK\` ASC LIMIT 1; `);
		}
		let boots = {};
		bootRows.forEach((row) => {
			boots[row.Time] = row.Status;
		});
		Server.sendTo(socket, {
			'module': 'boot',
			'command': 'replace',
			'data': {
				'system': header.system,
				'points': boots
			}
		});
	} catch (error) {
		Logs.error("Couldn't parse requested times", error)
	}
}

/* Config */

async function systemConfig(system) {
	const [systemConfig] = await SQL.query(`SELECT * FROM \`config\` WHERE \`system\` = '${system}'; `);
	return systemConfig;
}

/* Alerts */

async function tempAlert(text, temp, system) {
	if (!Config.get('sendWarnEmails')) return;
	const sysConfig = await systemConfig(system);
	if (!sysConfig.warnTemp) return;
	transporter.sendMail({
		from: `"${system} Temp Alerts" <${Config.get('emailFrom')}>`,
		to: sysConfig.warnEmails,
		subject: `${system} Temperature Alert`,
		text: `The ${text} temperature in ${system} is at a critical level! Current temperature is: ${temp}°C`
	});
	Logs.warn(`${system} - ${text} has exceeded the warning temperature and is at: ${temp}°C, emailing: ${sysConfig.warnEmails}`);
}

async function pingAlert(time, interval, system) {
	Logs.warn(`The ${system} Argos system has not pinged the server in ${time} ${interval}`);
	if (!Config.get('sendWarnEmails')) return;
	const sysConfig = await systemConfig(system);
	if (!sysConfig.warnPing) return;
	Logs.warn(`Email ping alerts are enabled for ${system}, emailing: ${sysConfig.warnEmails}`);
	transporter.sendMail({
		from: `"${system} Ping Alerts" <${Config.get('emailFrom')}>`,
		to: sysConfig.warnEmails,
		subject: `${system} Ping Alert`,
		text: `The ${system} Argos system has not pinged the server in ${time} ${interval}. It is either offline or has lost internet`
	});
}

async function bootAlert(system) {
	if (!Config.get('sendWarnEmails')) return;
	const sysConfig = await systemConfig(system);
	if (!sysConfig.warnBoot) return;
	transporter.sendMail({
		from: `"${system} Boot Alerts" <${Config.get('emailFrom')}>`,
		to: sysConfig.warnEmails,
		subject: `${system} Boot Alert`,
		text: `The ${system} Argos system has just booted`
	});
	Logs.warn(`The ${system} Argos system has just started, emailing: ${sysConfig.warnEmails}`);
}