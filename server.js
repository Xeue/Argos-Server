#!/usr/bin/env node
/*jshint esversion: 6 */
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';
import { createServer } from 'https';
import { createRequire } from "module";
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path'
import cors from 'cors';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const reader = require("readline-sync");
const mysql = require('mysql');
const nodemailer = require("nodemailer");

const args = process.argv.slice(2);
const version = "1.0";
const type = "Server";
const loadTime = new Date().getTime();

let DBConn = 0;
const SQLLogging = false;

class Datebase {
  constructor() {
    this.connection = mysql.createPool(MYsqlDetails);
    DBConn++;
    if (SQLLogging) {
      log(`${g}Connecting${w} to SQL database, current connections: ${y}${DBConn}${w}`, "S");
    }
  }
  query(sql, args) {
    return new Promise( ( resolve, reject ) => {
      this.connection.query( sql, args, ( err, rows ) => {
        if (err) {
          logObj("SQL Error", err, "E");
          return reject(err);
        }
        resolve( rows );
        if (SQLLogging) {
          logObj("Data from DB", rows, "A");
        }
      } );
    } );
  }
  insert(object, table, args) {
    return new Promise( ( resolve, reject ) => {
      let keys = [];
      let values = [];
      for (var variable in object) {
        if (object.hasOwnProperty(variable)) {
          keys.push(variable);
          values.push(`'${object[variable]}'`);
        }
      }
      let sql = `INSERT INTO \`${table}\` (${keys.join(',')}) VALUES (${values.join(',')})`;
      this.connection.query( sql, args, ( err, result, fields ) => {
        if (err) {
          logObj("SQL Error", err, "E");
          return reject(err);
        }
        resolve( result );
        if (SQLLogging) {
          logObj("Inserted into DB", result, "A");
        }
      } );
    } );
  }
  update(object, where, table, args) {
    return new Promise( ( resolve, reject ) => {

      let values = [];
      for (var variable in object) {
        if (object.hasOwnProperty(variable)) {
          values.push(`\`${variable}\`='${object[variable]}'`);
        }
      }
      let sql = `UPDATE \`${table}\` SET ${values.join(',')}`;
      if (typeof where !== "undefined") {
        let wheres = [];
        for (var col in where) {
          if (where.hasOwnProperty(col)) {
            wheres.push(`\`${col}\`='${where[col]}'`);
          }
        }
        sql += ' WHERE '+wheres.join(' AND ');
      }

      this.connection.query( sql, args, ( err, result, fields ) => {
        if (err) {
          logObj("SQL Error", err, "E");
          return reject(err);
        }
        resolve( result );
        if (SQLLogging) {
          logObj("Updated DB", result, "A");
        }
      } );
    } );
  }
  close() {
    return new Promise( ( resolve, reject ) => {
      DBConn--;
      if (SQLLogging) {
        log(`${r}Closing${w} connection to SQL database, current connections: ${y}${DBConn}${w}`, "S");
      }
      this.connection.end( err => {
        if (err) {
          logObj("SQL Error", err, "E");
          return reject(err);
        }
        resolve();
      } );
    } );
  }
}


let myID = `S_${loadTime}_${version}`;
let configLocation = __dirname;
let port = 443;
let host;
let loggingLevel = "W";
let debugLineNum = true;
let createLogFile = true;
let argLoggingLevel;
let ownHTTPserver = true;
let dbAddress = "localhost";
let dbUsername = "wbs";
let dbPassword = "NEPVisions!";
let dbName = "wbs";
let pingList = [];
let certPath;
let keyPath;
let serverName = "OB Monitoring Server v"+version;
let printPings = false;
let latePings = 0;
let latePing = true;
let warnTemp = 29;
let warnEmails;
let emailOptions;
let MYsqlDetails;

let r = "\x1b[31m";
let g = "\x1b[32m";
let y = "\x1b[33m";
let b = "\x1b[34m";
let p = "\x1b[35m";
let c = "\x1b[36m";
let w = "\x1b[37m";
let reset = "\x1b[0m";
let dim = "\x1b[2m";
let bright = "\x1b[1m";

let config;

var coreServer;
var serverHTTPS;

loadArgs();

loadConfig();
let transporter = nodemailer.createTransport(emailOptions);

startServer();

startLoops();

function startServer() {
  if (ownHTTPserver) {
    coreServer = new WebSocketServer({ noServer: true });

    serverHTTPS = startHTTPS();
    log("Running as own HTTPS server and hosting UI internally");
  } else {
    log(`Running as ${y}standalone${w} websocket server`);
    coreServer = new WebSocketServer({ port: port });
  }
  log("Started Websocket server");

  // Main websocket server functionality
  coreServer.on('connection', function connection(socket) {
    log("New connection established", "D");

    socket.pingStatus = "alive";

    socket.on('message', function message(msgJSON) {
      let msgObj = {};
      let pObj;
      let hObj;
      try {
        msgObj = JSON.parse(msgJSON);
        if (msgObj.payload.command !== "ping" && msgObj.payload.command !== "pong") {
          logObj('Received', msgObj, "A");
        } else if (printPings == true) {
          logObj('Received', msgObj, "A");
        }
        pObj = msgObj.payload;
        hObj = msgObj.header;
        if (typeof pObj.source == "undefined") {
          pObj.source = "default";
        }
        switch (pObj.command) {
          case "meta":
            log('Received: '+msgJSON, "D");
            socket.send("Received meta");
            break;
          case "register":
            coreDoRegister(socket, msgObj);
            break;
          case "disconnect":
            log(`${r}${pObj.data.ID}${reset} Connection closed`, "D");
            sendConfigs(msgObj, socket);
            sendServers(msgObj);
            break;
          case "pong":
            socket.pingStatus = "alive";
            break;
          case "ping":
            socket.pingStatus = "alive";
            let payload = {};
            payload.command = "pong";
            sendData(socket, payload);
            break;
          case "error":
            log(`Device ${hObj.fromID} has entered an error state`, "E");
            log(`Message: ${pObj.error}`, "E");
            break;
          case "log":
            handleLog(hObj, pObj);
            break;
          case "get":
            handleGet(hObj, pObj);
            break;
          default:
            logObj("Unknown message", msgObj, "W");
        }
      } catch (e) {
        try {
          msgObj = JSON.parse(msgJSON);
          if (msgObj.payload.command !== "ping" && msgObj.payload.command !== "pong") {
            logObj('Received', msgObj, "A");
          } else if (printPings == true) {
            logObj('Received', msgObj, "A");
          }
          if (typeof msgObj.type == "undefined") {
            let stack = e.stack.toString().split(/\r\n|\n/);
            stack = JSON.stringify(stack, null, 4);
            log(`Server error, stack trace: ${stack}`, "E");
          } else {
            log("A device is using old tally format, upgrade it to v4.0 or above", "E");
          }
        } catch (e2) {
          log("Invalid JSON - "+e, "E");
          log('Received: '+msgJSON, "A");
        }
      }
    });

    socket.on('close', function() {
      try {
        let oldId = JSON.parse(JSON.stringify(socket.ID));
        log(`${r}${oldId}${reset} Connection closed`, "D");
        socket.connected = false;
      } catch (e) {
        log("Could not end connection cleanly","E");
      }
    });
  });

  coreServer.on('error', function() {
    log("Server failed to start or crashed, please check the port is not in use", "E");
    process.exit(1);
  });

  if (ownHTTPserver) {
    serverHTTPS.listen(port);
  }
}

function startLoops() {

  // 5 Second ping loop
  setInterval(() => {
    doPing();
  }, 5*1000);

  // 5 Minute ping loop
  setInterval(() => {

  }, 60*1000*5);

}

function doPing() {
  if (printPings !== false) {
    log("Doing ping", "A");
  }
  let counts = {};
  counts.alive = 0;
  counts.dead = 0;
  coreServer.clients.forEach(function each(client) {
    if (client.readyState === 1) {
      if (client.pingStatus == "alive") {
        counts.alive++;
        let payload = {};
        payload.command = "ping";
        sendData(client, payload);
        client.pingStatus = "pending";
      } else if (client.pingStatus == "pending") {
        client.pingStatus = "dead";
      } else {
        counts.dead++;
      }
    }
  });
  if (printPings !== false) {
    log("Clients alive: "+counts.alive, "A");
    log("Clients dead: "+counts.dead, "A");
  }
}

/* Core functions & Message handeling */

function coreDoRegister(socket, msgObj) {
  let hObj = msgObj.header;
  let pObj = msgObj.payload;
  if (typeof socket.type == "undefined") {
    socket.type = hObj.type;
  }
  if (typeof socket.ID == "undefined") {
    socket.ID = hObj.fromID;
  }
  if (typeof socket.version == "undefined") {
    socket.version = hObj.version;
  }
  if (typeof socket.prodID == "undefined") {
    socket.prodID = hObj.prodID;
  }
  if (hObj.version !== version) {
    if (hObj.version.substr(0, hObj.version.indexOf('.')) != version.substr(0, version.indexOf('.'))) {
      log("Connected client has different major version, it will not work with this server!", "E");
    } else {
      log("Connected client has differnet version, support not guaranteed", "W");
    }
  }
  log(`${g}${hObj.fromID}${reset} Registered as new client`, "D");
  socket.connected = true;
  if (typeof pObj.data !== "undefined") {
    if (typeof pObj.data.camera !== "undefined") {
      socket.camera = pObj.data.camera;
    }
  }
}

function sendClients(json, socket = null) { //All but servers
  let obj = {};
  if (typeof json == "object") {
    obj = json;
  } else {
    obj = JSON.parse(json);
  }

  let recipients = obj.header.recipients;
  let returnObj = updateHeader(obj);
  coreServer.clients.forEach(function each(client) {
    if (client !== socket && client.readyState === WebSocket.OPEN) {
      if (!recipients.includes(client.address) && client.type != "Server") {
        client.send(JSON.stringify(returnObj));
      }
    }
  });
}

function sendSelf(json, socket) {
  let obj = {};
  if (typeof json == "object") {
    obj = json;
  } else {
    obj = JSON.parse(json);
  }
  let returnObj = updateHeader(obj);

  socket.send(JSON.stringify(returnObj));
}

/* Websocket packet functions */

function makeHeader(intType = type, intVersion = version) {
  let header = {};
  header.fromID = myID;
  header.timestamp = new Date().getTime();
  header.version = intVersion;
  header.type = intType;
  header.active = true;
  header.messageID = header.timestamp;
  header.recipients = [
    host
  ];
  return header;
}

function makePacket(json) {
  let payload = {};
  if (typeof json == "object") {
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

function updateHeader(json, relayed = true) {
  let msgObj = {};
  if (typeof json == "object") {
    msgObj = JSON.parse(JSON.stringify(json));
  } else {
    msgObj = JSON.parse(json);
  }
  let header = msgObj.header;
  return msgObj;
}

function sendData(connection, payload) {
  let packet = {};
  let header = makeHeader();
  packet.header = header;
  packet.payload = payload;
  connection.send(JSON.stringify(packet));
}

function arrayUnique(array) {
  var a = array.concat();
  for(var i=0; i<a.length; ++i) {
    for(var j=i+1; j<a.length; ++j) {
      if(a[i] === a[j])
        a.splice(j--, 1);
    }
  }
  return a;
}

/* Express */

function startHTTPS() {
  log("Starting HTTPS server");
  if (ownHTTPserver) {
    let sslCert;
    let sslKey;

    try {
      sslCert = fs.readFileSync(certPath, { encoding: 'utf8' });
    } catch (e) {
      log("Could not load server SSL certificate", "E");
      process.exit(1);
    }

    try {
      sslKey = fs.readFileSync(keyPath, { encoding: 'utf8' });
    } catch (e) {
      log("Could not load server SSL key", "E");
      process.exit(1);
    }

    let options = {
      cert: sslCert,
      key: sslKey
    };

    const app = express();
    const serverHTTPS = createServer(options, app);

    setInterval(checkPing, 10*1000);

    serverHTTPS.on('upgrade', (request, socket, head) => {
      log("Upgrade request received", "D");
      coreServer.handleUpgrade(request, socket, head, socket => {
        coreServer.emit('connection', socket, request);
      });
    });

    app.set('views', __dirname + '/views');
    app.set('view engine', 'ejs');
    app.use(cors());
    app.use(express.json());
    app.use(express.static('public'));

    app.get('/', function(request, response) {
      handleRoot(request, response);
    });

    app.get('/REST/getTemps', function(request, response) {
      getTemps(request, response);
    });

    return serverHTTPS;
  } else {
    return null;
  }
}

/* Handelers */

function handleLog(header, payload) {
  switch (payload.type) {
    case "ping":
      handlePing(header.system);
      break;
    case "boot":
      handleBoot(header.system);
      break;
    case "temperature":
      handleTemps(header.system, payload);
      break;
  }
}

function handleGet(header, payload) {
  switch (payload.data) {
    case "temperature":
      getTemperature(header, payload);
      break;
    case "ping":
      getPings(header, payload);
      break;
    default:

  }
}

function handleRoot(request, response) {
  log("Serving index page", "A");
  response.header('Content-type', 'text/html');
  const MConn = new Datebase();
  let ping;
  let pings;
  let boot;
  let boots;
  let systems = [];

  MConn.query("SELECT `System` AS 'Name' FROM `status` GROUP BY `System`;")
  .then((rows)=>{
    rows.forEach((row) => {
      systems.push(row.Name);
    });
    return MConn.query("SELECT * FROM `status` WHERE `Type`='Ping' AND `Status` = 1 ORDER BY `PK` DESC LIMIT 1;")
  }).then((rows)=>{
    ping = rows[0];
    return MConn.query("SELECT * FROM `status` WHERE `Type`='Ping' AND `PK` mod 10 = 0 ORDER BY `PK` DESC LIMIT 144;")
  }).then((rows)=>{
    pings = {};
    rows.forEach( (row) => {
      pings[row.Time] = row.Status;
    });
    return MConn.query("SELECT * FROM `status` WHERE `Type`='Boot' ORDER BY `PK` DESC;")
  }).then((rows)=>{
    boot = rows[0];
    boots = {};
    rows.forEach( (row) => {
      boots[row.Time] = 1;
    });

    MConn.close();
    response.render('index', {
      host: host,
      serverName: serverName,
      pings: pings,
      ping: ping,
      boots: boots,
      boot: boot,
      systems: systems.filter(Boolean)
    });
  });
}

function handlePing(system) {
  log("Recieved a ping", "D");
  let systems = pingList.map((item) => {return item?.name});
  if (!systems.includes(system)) {
    let obj = {
      name: system,
      latePing: false,
      latePings: 0
    }
    pingList.push(obj);
  }
  resetPings(system);
  const MConn = new Datebase();
  MConn.insert({"Type":"Ping", "Status":1, "System":system}, "status").then((result)=>{
    MConn.close();
    sendClients(makePacket({
      "command":"data",
      "data":"ping",
      "status":1,
      "system": system,
      "time": new Date().getTime()
    }));
    log("Recorded Ping", "D");
  });
}

function handleBoot(system) {
  log("Recieved a boot", "D");
  bootAlert("W", system);
  const MConn = new Datebase();
  MConn.insert({"Type":"Boot", "Status":1, "System":system}, "status").then((result)=>{
    MConn.close();
    sendClients(makePacket({
      "command":"data",
      "data":"boot",
      "time": new Date().getTime()
    }));
    log("Recorded boot", "D");
  });
}

function handleTemps(system, payload) {
  log("Recieved some temps", "D");

  const MConn = new Datebase();
  let promises = [];
  let average = 0;
  let timeStamp = new Date().getTime();
  let dataObj = {
    "command":"data",
    "data":"temps",
    "system":system,
    "replace": false,
    "points":{}
  };
  dataObj.points[timeStamp] = {};

  payload.data.forEach((frame) => {

    if (typeof frame.Temp !== "undefined") {
      average += frame.Temp;
      if (frame.Temp > warnTemp) {
        tempAlert("W", frame.Name, frame.Temp, system);
      }
      dataObj.points[timeStamp][frame.Name] = frame.Temp;
      let promise = MConn.insert({
        "frame": frame.Name,
        "temperature": frame.Temp,
        "system": system
      }, "temperature");
      promises.push(promise);
    }
  });

  average = average/promises.length;
  dataObj.points[timeStamp].average = average;

  Promise.allSettled(promises).then((values) => {
    MConn.close();
  })

  sendClients(makePacket(dataObj));
}

function getPings(header, payload) {
  log("Getting Pings", "D");
  let from = payload.from;
  let to = payload.to;
  const MConn = new Datebase();
  let countQuery = `SELECT count(\`PK\`) AS 'total' FROM \`status\` WHERE time BETWEEN FROM_UNIXTIME(${from}) AND FROM_UNIXTIME(${to}) AND \`system\` = '${header.system}' ORDER BY \`PK\` ASC; `;
  MConn.query(countQuery).then((rows)=>{
    let total = rows[0].total;
    let divisor = Math.ceil(total/1000);
    let query = `SELECT * FROM \`status\` WHERE (\`Type\`='Ping' AND MOD(\`PK\`, ${divisor}) = 0 OR \`Status\`='0') AND Time BETWEEN FROM_UNIXTIME(${from}) AND FROM_UNIXTIME(${to}) AND \`system\` = '${header.system}' ORDER BY \`PK\` ASC; `;
    return MConn.query(query);
  }).then((rows)=>{
    let pings = {};
    rows.forEach((row) => {
      pings[row.Time] = row.Status;
    });
    MConn.close();

    let dataObj = {
      "command": "data",
      "data": "ping",
      "replace": true,
      "system": header.system,
      "points": pings
    };

    sendClients(makePacket(dataObj));
  });
}

function getTemperature(header, payload) {
  log(`Getting temps for ${header.system}`, "D");
  let from = payload.from;
  let to = payload.to;
  const MConn = new Datebase();
  let dateQuery = `SELECT ROW_NUMBER() OVER (ORDER BY PK) AS Number, \`PK\`, \`time\` FROM \`temperature\` WHERE time BETWEEN FROM_UNIXTIME(${from}) AND FROM_UNIXTIME(${to}) AND \`system\` = '${header.system}' GROUP BY \`time\`; `;
  MConn.query(dateQuery).then((grouped)=>{
    let divisor = Math.ceil(grouped.length/1000);
    let whereArr = grouped.map((a)=>{
      if (a.Number % divisor == 0) {
        let data = new Date(a.time).toISOString().slice(0, 19).replace('T', ' ');
        return `'${data}'`;
      }
    }).filter(Boolean);
    let whereString = whereArr.join(",");
    let query;
    if (whereString == "") {
      query = `SELECT * FROM \`temperature\` WHERE \`system\` = '${header.system}' ORDER BY \`PK\` ASC LIMIT 1; `;
    } else {
      query = `SELECT * FROM \`temperature\` WHERE time IN (${whereString}) AND \`system\` = '${header.system}' ORDER BY \`PK\` ASC; `;
    }
    return MConn.query(query);
  }).then((rows)=>{
    MConn.close();
    let dataObj = {
      "command":"data",
      "data":"temps",
      "system":header.system,
      "replace": true,
      "points":{}
    };

    rows.forEach((row, i) => {
      let timestamp = row.time.getTime();
      if (!dataObj.points[timestamp]) {
        dataObj.points[timestamp] = {};
      }
      let point = dataObj.points[timestamp];
      point[row.frame] = row.temperature;

      delete point.average;
      const n = Object.keys(point).length;
      const values = Object.values(point);
      const total = values.reduce((accumulator, value) => {
        return accumulator + value;
      }, 0);
      point.average = total/n;
    });

    sendClients(makePacket(dataObj));
  });
}

function resetPings(system) {
  let systems = pingList.map((item) => {return item?.name});
  let index = systems.indexOf(system);
  pingList[index].latePing = false;
  pingList[index].latePings = 0;
}

function checkPing() {
  pingList.forEach((system, i) => {
    sysConfig(system.name).then((config)=>{
      if (system.latePing && (config.warnPing)) {
        doLatePing(system);
      } else {
        system.latePing = true;
        system.latePings = 0;
      }
    });
  });
}

function doLatePing(system) {
  system.latePings++;

  if (system.latePings > 1080) {
    if (system.latePings % 2160 == 0) {
      pingAlert("W", system.latePings/360, "hours", system.name);
    }
  } else if (system.latePings > 359) {
    if (system.latePings % 360 == 0) {
      pingAlert("W", system.latePings/360, "hours", system.name);
    }
  } else if (system.latePings > 31) {
    if (system.latePings % 60 == 0) {
      pingAlert("W", system.latePings/6, "minutes", system.name);
    }
  } else if (system.latePings > 5) {
    if (system.latePings % 6 == 0) {
      pingAlert("W", system.latePings/6, "minutes", system.name);
    }
  }
  const MConn = new Datebase();
  MConn.insert({"Type":"Ping", "Status":0, "System":system.name}, "status").then((result)=>{
    MConn.close();
    sendClients(makePacket({
      "command":"data",
      "data":"ping",
      "status":0,
      "system": system.name,
      "time": new Date().getTime()
    }));
    log(`${system.name} missed ${system.latePings} pings`, "W");
  });
}

/* Config */

function sysConfig(system) {
  const MConn = new Datebase();
  return MConn.query(`SELECT * FROM \`config\` WHERE \`system\` = '${system}'; `).then((rows)=>{
    MConn.close();
    return rows[0];
  });
}

function loadConfig(fromFile = true) {
  if (fromFile) {
    try {
      config = JSON.parse(fs.readFileSync(configLocation+'/config.conf', { encoding: 'utf8' }));
    } catch (e) {
      createConfig(true);
    }
  } else {
    createConfig(false);
  }

  if (typeof config.createLogFile !== "undefined") {
    createLogFile = config.createLogFile;
  } else {
    createLogFile = true;
  }

  printHeader();

  if (typeof argLoggingLevel !== "undefined") {
    loggingLevel = argLoggingLevel;
  } else if (typeof config.loggingLevel !== "undefined") {
    loggingLevel = config.loggingLevel;
  } else {
    loggingLevel = "W"; //(A)LL,(D)EBUG,(W)ARN,(E)RROR
  }

  if (typeof config.debugLineNum !== "undefined") {
    debugLineNum = config.debugLineNum;
  } else {
    debugLineNum = false;
  }

  if (typeof config.port !== "undefined") {
    port = config.port;
  } else {
    port = 443;
  }

  if (typeof config.serverName !== "undefined") {
    serverName = config.serverName;
  } else {
    serverName = "OB Monitoring v"+version;
  }

  if (typeof config.printPings !== "undefined") {
    printPings = config.printPings;
  } else {
    printPings = false;
  }

  if (typeof config.host !== "undefined") {
    host = config.host;
  } else {
    host = 443;
  }

  if (typeof config.ownHTTPserver !== "undefined") {
    ownHTTPserver = config.ownHTTPserver;
  } else {
    ownHTTPserver = false;
  }

  if (typeof config.warnTemp !== "undefined") {
    warnTemp = config.warnTemp;
  } else {
    warnTemp = 29;
  }

  if (typeof config.warnEmails !== "undefined") {
    warnEmails = config.warnEmails;
  } else {
    warnEmails = "sam@xeue.uk";
  }

  if (typeof config.certPath !== "undefined") {
    certPath = config.certPath;
  } else {
    certPath = "keys/"+host+".pem";
  }

  if (typeof config.keyPath !== "undefined") {
    keyPath = config.keyPath;
  } else {
    keyPath = "keys/"+host+".key";
  }

  debugLineNum = (debugLineNum === "false" || debugLineNum === false) ? false : true;
  createLogFile = (createLogFile === "false" || createLogFile === false) ? false : true;
  ownHTTPserver = (ownHTTPserver === "false" || ownHTTPserver === false) ? false : true;
  port = parseInt(port);

  log(`Monitoring server running on port: ${y}${port}${w}`);
  switch (loggingLevel) {
    case "A":
      log(`Logging set to ${y}All${w}`);
      break;
    case "D":
      log(`Logging set to ${y}Debug${w} & ${y}Network{w}`);
      break;
    case "W":
      log(`Logging set to ${y}Warning${w} & ${y}Error${w}`);
      break;
    case "E":
      log(`Logging set to ${y}Error${w} only`);
      break;
    default:
  }

  log("Show line number in logs set to: "+debugLineNum);

  let today = new Date();
  let dd = String(today.getDate()).padStart(2, '0');
  let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
  let yyyy = today.getFullYear();

  let fileName = `${configLocation}/monitoringServer-[${yyyy}-${mm}-${dd}].log`;
  log(`Logging to file: ${y}${fileName}${w}`);

  if (typeof config.emailOptions !== "undefined") {
    emailOptions = config.emailOptions;
  } else {
    emailOptions = {};
  }

  if (typeof config.dataBase !== "undefined" && config.dataBase !== false) {
    log(`Setting up ${y}with${w} database connection`, "C");
    MYsqlDetails = config.dataBase;
    const MConn = new Datebase();
    let promises = [];
    promises[0] = MConn.query(`SELECT count(*) as count
      FROM information_schema.TABLES
      WHERE (TABLE_SCHEMA = '${config.dataBase.database}') AND (TABLE_NAME = 'temps')
    `).then((rows)=>{
      if (rows[0].count == 0) {
        log("Temperature table doesn't exist, creating new one", "S");
        return MConn.query(`CREATE TABLE \`temps\` (
            \`PK\` int(11) NOT NULL,
            \`f\` float NOT NULL,
            \`m\` float NOT NULL,
            \`b\` float NOT NULL,
            \`a\` float NOT NULL,
            \`time\` timestamp NOT NULL DEFAULT current_timestamp(),
            PRIMARY KEY (\`PK\`)
          ) ENGINE=InnoDB DEFAULT CHARSET=latin1`)
        .then(function() {
          return MConn.query("ALTER TABLE `temps` MODIFY `PK` int(11) NOT NULL AUTO_INCREMENT;");
        });
      } else {
        log("Temperature table already exists", "D");
      }
    });

    promises[1] = MConn.query(`SELECT count(*) as count
      FROM information_schema.TABLES
      WHERE (TABLE_SCHEMA = '${config.dataBase.database}') AND (TABLE_NAME = 'status')
    `).then((rows)=>{
      if (rows[0].count == 0) {
        log("Status table doesn't exist, creating new one", "S");
        return MConn.query(`CREATE TABLE \`status\` (
            \`PK\` int(11) NOT NULL,
            \`Type\` varchar(255) NOT NULL,
            \`Status\` tinyint(1) NOT NULL,
            \`Time\` timestamp NOT NULL DEFAULT current_timestamp(),
            \`System\` varchar(256) DEFAULT NULL,
            PRIMARY KEY (\`PK\`)
          ) ENGINE=InnoDB DEFAULT CHARSET=latin1`)
        .then(function() {
          return MConn.query("ALTER TABLE `status` MODIFY `PK` int(11) NOT NULL AUTO_INCREMENT;");
        });
      } else {
        log("Status table already exists", "D");
      }
    });

    promises[2] = MConn.query(`SELECT count(*) as count
      FROM information_schema.TABLES
      WHERE (TABLE_SCHEMA = '${config.dataBase.database}') AND (TABLE_NAME = 'config')
    `).then((rows)=>{
      if (rows[0].count == 0) {
        log("Config table doesn't exist, creating new one", "S");
        return MConn.query(`CREATE TABLE \`config\` (
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
          ) ENGINE=InnoDB DEFAULT CHARSET=latin1`)
        .then(function() {
          return MConn.query("ALTER TABLE `config` MODIFY `PK` int(11) NOT NULL AUTO_INCREMENT;");
        });
      } else {
        log("Config table already exists", "D");
      }
    });

    Promise.allSettled(promises).then((values) => {
      MConn.close();
    })
  } else {
    log(`Running ${y}without${w} database connection, this means Argos will not record any data`, "C");
  }
}

function createConfig(error = true) {
  if (error) {
    log("Config could not be loaded, missing file or invalid JSON?", "E");
  }
  log("Creating new config file");

  if (!fs.existsSync(configLocation)){
    fs.mkdirSync(configLocation, { recursive: true });
  }

  let port = reader.question("What port shall the server use: ");
  let host = reader.question("What url/IP is the server connected to from: ");
  let serverName = reader.question("Please name this server: ");
  let loggingLevel = reader.question("What logging level would you like? (A)ll (D)ebug (W)arnings (E)rror: ");
  let debugLineNum = reader.question("Would you like to print line numbers in the logs? true/false: ");
  let createLogFile = reader.question("Would you like to write the log to a file? true/false: ");
  let warnTemp = reader.question("Temperature to warn at: ");
  let warnEmails = reader.question("Comma seperated emails to send warnings to: ");
  let ownHTTPserver = reader.question("Should this sever be it's own https server? true/false: ");
  let certPath;
  let keyPath;
  if (ownHTTPserver == true || ownHTTPserver == "true") {
    certPath = reader.question("Path to SSL certificate (normally .pem) eg. /keys/cert.pem: ");
    keyPath = reader.question("Path to SSL key (normally .key) eg. /keys/cert.key: ");
  }

  port = parseInt(port);
  debugLineNum = (debugLineNum === "false" || debugLineNum === false) ? false : true;
  createLogFile = (createLogFile === "false" || createLogFile === false) ? false : true;
  ownHTTPserver = (ownHTTPserver === "false" || ownHTTPserver === false) ? false : true;

  config = {
    "port":port,
    "host":host,
    "serverName":serverName,
    "loggingLevel":loggingLevel,
    "debugLineNum":debugLineNum,
    "createLogFile":createLogFile,
    "ownHTTPserver":ownHTTPserver
  };
  if (ownHTTPserver == true || ownHTTPserver == "true") {
    config.certPath = certPath;
    config.keyPath = keyPath;
  }
  try {
    fs.writeFileSync(configLocation+'/config.conf', JSON.stringify(config, null, 4));
    log("Config saved to file");
  } catch (error) {
    log("Could not write config file, running with entered details anyway", "E");
  }
}

/* Alerts */

function tempAlert(level, text, temp, system) {
  sysConfig(system).then((config)=>{
    transporter.sendMail({
      from: `"${system} Temp Alerts" <sam@chilton.tv>`,
      to: config.warnEmails,
      subject: `${system} Temperature Alert`,
      text: `The ${text} temperature is at a critical level! Current temperature is: ${temp}°C`
    });
    log(`The ${text} temperature in ${system} is at a critical level! Current temperature is: ${temp}°C, emailing: ${config.warnEmails}`, level);
  });
}

function pingAlert(level, time, interval, system) {
  sysConfig(system).then((config)=>{
    transporter.sendMail({
      from: `"${system} Ping Alerts" <sam@chilton.tv>`,
      to: config.warnEmails,
      subject: `${system} Ping Alert`,
      text: `The ${system} Vision PC has not pinged the server in ${time} ${interval}. It is either offline or has lost internet`
    });
    log(`The ${system} Vision PC has not pinged the server in ${time} ${interval}. It is either offline or has lost internet, emailing: ${config.warnEmails}`, level);
  });
}

function bootAlert(level, system) {
  sysConfig(system).then((config)=>{
    transporter.sendMail({
      from: `"${system} Boot Alerts" <sam@chilton.tv>`,
      to: config.warnEmails,
      subject: `${system} Boot Alert`,
      text: `The ${system} Vision PC has just booted`
    });
    log(`The ${system} Vision PC has just booted, emailing: ${config.warnEmails}`, level);
  });
}

/* Logging */

function printHeader() {
  console.log("  ____   ____     __  __                _  _               ");
  console.log(" / __ \\ |  _ \\   |  \\/  |              (_)| |              ");
  console.log("| |  | || |_) |  | \\  / |  ___   _ __   _ | |_  ___   _ __ ");
  console.log("| |  | ||  _ <   | |\\/| | / _ \\ | '_ \\ | || __|/ _ \\ | '__|");
  console.log("| |__| || |_) |  | |  | || (_) || | | || || |_| (_) || |   ");
  console.log(" \\____/ |____/   |_|  |_| \\___/ |_| |_||_| \\__|\\___/ |_|   ");
  console.log("                                                         ");

  logFile("  ____   ____     __  __                _  _               ", true);
  logFile("/ __ \\ |  _ \\   |  \\/  |              (_)| |              ", true);
  logFile("| |  | || |_) |  | \\  / |  ___   _ __   _ | |_  ___   _ __ ", true);
  logFile("| |  | ||  _ <   | |\\/| | / _ \\ | '_ \\ | || __|/ _ \\ | '__|", true);
  logFile("| |__| || |_) |  | |  | || (_) || | | || || |_| (_) || |   ", true);
  logFile("\\____/ |____/   |_|  |_| \\___/ |_| |_||_| \\__|\\___/ |_|   ", true);
  logFile("                                                         ", true);
}

function loadArgs() {
  if (typeof args[0] !== "undefined") {
    if (args[0] == "--help" || args[0] == "-h" || args[0] == "-H" || args[0] == "--h" || args[0] == "--H") {
      log(`You can start the server with two arguments: (config path) (logging level)`, "H");
      log(`The first argument is the relative path of the config file, eg (${y}.${reset}) or (${y}/Config1${reset})`, "H");
      log(`The second argument is the desired logging level ${w+dim}(A)ll${reset}, ${c}(D)ebug${reset}, ${y}(W)arnings${reset}, ${r}(E)rrors${reset}`, "H");
      process.exit(1);
    }
    if (args[0] == ".") {
      args[0] = "";
    }
    configLocation = __dirname+args[0];
  } else {
    configLocation = __dirname;
  }

  if (typeof args[1] !== "undefined") {
    argLoggingLevel = args[1];
  }
}

function log(message, level, lineNumInp) {
  let e = new Error();
  let stack = e.stack.toString().split(/\r\n|\n/);
  let lineNum = '('+stack[2].substr(stack[2].indexOf("server.js:")+10);
  if (typeof lineNumInp !== "undefined") {
    lineNum = lineNumInp;
  }
  if (lineNum[lineNum.length - 1] !== ")") {
    lineNum += ")";
  }
  let timeNow = new Date();
  let hours = String(timeNow.getHours()).padStart(2, "0");
  let minutes = String(timeNow.getMinutes()).padStart(2, "0");
  let seconds = String(timeNow.getSeconds()).padStart(2, "0");
  let millis = String(timeNow.getMilliseconds()).padStart(3, "0");

  let timeString = `${hours}:${minutes}:${seconds}.${millis}`;

  if (typeof message === "undefined") {
    log(`Log message from line ${p}${lineNum}${reset} is not defined`, "E");
    return;
  } else if (typeof message !== "string") {
    log(`Log message from line ${p}${lineNum}${reset} is not a string so attemping to stringify`, "A");
    try {
      message = JSON.stringify(message, null, 4);
    } catch (e) {
      log(`Log message from line ${p}${lineNum}${reset} could not be converted to string`, "E");
    }
  }

  if (debugLineNum == false || debugLineNum == "false") {
    lineNum = "";
  }

  message = message.replace(/true/g, g+"true"+w);
  message = message.replace(/false/g, r+"false"+w);
  message = message.replace(/null/g, y+"null"+w);
  message = message.replace(/undefined/g, y+"undefined"+w);

  const regexp = / \((.*?):(.[0-9]*):(.[0-9]*)\)"/g;
  let matches = message.matchAll(regexp);
  for (let match of matches) {
    message = message.replace(match[0],`" [${y}${match[1]}${reset}] ${p}(${match[2]}:${match[3]})${reset}`);
  }

  let msg;
  switch (level) {
    case "A":
      if (loggingLevel == "A") { //White
        logSend(`[${timeString}]${w}  INFO: ${dim}${message}${bright} ${p}${lineNum}${reset}`);
      }
      break;
    case "D":
      if (loggingLevel == "A" || loggingLevel == "D") { //Cyan
        logSend(`[${timeString}]${c} DEBUG: ${w}${message} ${p}${lineNum}${reset}`);
      }
      break;
    case "S":
      if (loggingLevel == "A" || loggingLevel == "D") { //Blue
        logSend(`[${timeString}]${b} NETWK: ${w}${message} ${p}${lineNum}${reset}`);
      }
      break;
    case "W":
      if (loggingLevel != "E") { //Yellow
        logSend(`[${timeString}]${y}  WARN: ${w}${message} ${p}${lineNum}${reset}`);
      }
      break;
    case "E": //Red
      logSend(`[${timeString}]${r} ERROR: ${w}${message} ${p}${lineNum}${reset}`);
      break;
    case "H": //Green
      logSend(`[${timeString}]${g}  HELP: ${w}${message}`);
      break;
    default: //Green
      logSend(`[${timeString}]${g}  CORE: ${w}${message} ${p}${lineNum}${reset}`);
  }
}

function logObj(message, obj, level) {
  let e = new Error();
  let stack = e.stack.toString().split(/\r\n|\n/);
  let lineNum = '('+stack[2].substr(stack[2].indexOf("server.js:")+10);

  let combined = `${message}: ${JSON.stringify(obj, null, 4)}`;
  log(combined, level, lineNum);
}

function logSend(message) {
  logFile(message);
  logSocket(message);
  console.log(message);
}

function logSocket(message) {
  if (typeof coreServer !== "undefined") {
    let packet = makePacket({"command":"log","data":{"log":message}});
    //sendAdmins(packet);
  }
}

function logFile(msg, sync = false) {
  if (createLogFile) {
    let dir = `${configLocation}/logs`;

    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
    }

    let today = new Date();
    let dd = String(today.getDate()).padStart(2, '0');
    let mm = String(today.getMonth() + 1).padStart(2, '0');
    let yyyy = today.getFullYear();

    let fileName = `${dir}/monitorServer-[${yyyy}-${mm}-${dd}].log`;
    let data = msg.replaceAll(r, "").replaceAll(g, "").replaceAll(y, "").replaceAll(b, "").replaceAll(p, "").replaceAll(c, "").replaceAll(w, "").replaceAll(reset, "").replaceAll(dim, "").replaceAll(bright, "")+"\n";

    if (sync) {
      try {
        fs.appendFileSync(fileName, data);
      } catch (error) {
        createLogFile = false;
        log("Could not write to log file, permissions?", "E");
      }
    } else {
      fs.appendFile(fileName, data, err => {
        if (err) {
          createLogFile = false;
          log("Could not write to log file, permissions?", "E");
        }
      });
    }
  }
}
