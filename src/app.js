'use strict';

// check environment  --------------------------------------------------------------------------------------------------

if (!process.env['NODE_ENV']) {
  throw new Error('Environment variable NODE_ENV is missing');
} else if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "development") {
  //'STREAM_CLIENT_URL', 'SENTRY_DSN'
  ['SERVER_PORT'].forEach((name) => {
    if (!process.env[name]) {
      throw new Error(`Environment variable ${name} is missing`);
    }
  });
}

// packages ------------------------------------------------------------------------------------------------------------

const fs        = require('fs');
const path      = require('path');
const https     = require('httpolyglot');
const express   = require('express');
const socketIO  = require("socket.io");
const mediasoup = require('mediasoup');

// modules -------------------------------------------------------------------------------------------------------------

const config    = require('./config');
const logger    = require("./logger");
const setupSocketHandlers = require("./SocketHandlers");

// const ---------------------------------------------------------------------------------------------------------------
const app       = express();
let options     = {};

if (process.env.NODE_ENV === "myhost") {
  options   = {
    key: fs.readFileSync(path.join(__dirname, config.sslKey), 'utf-8'),
    cert: fs.readFileSync(path.join(__dirname, config.sslCrt), 'utf-8')
  };
}


const httpsServer = https.createServer(options, app);
const io          = socketIO(httpsServer,{
  path: '/webcam/',
  serveClient: false,
  log: false,
  cors: {
    origin: "*",
    credentials: true,
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')))


// For Devops-----------------------------------------------------------------------------------------------------------

app.get(["/readiness", "/liveness"], (_, res) => {
  res.json({ data: "OK!" });
});

// Global variables ---------------------------------------------------------------------------------------------------------------

let workers                = []; // all mediasoup workers
let roomList               = new Map();
/**
 * roomList
 * {
 *  roomId: Room {
 *      id:
 *      router:
 *      peers: {
 *          id:,
 *          userId:,
 *          master: [boolean],
 *          transports: [Map],
 *          producers: [Map],
 *          consumers: [Map],
 *          rtpCapabilities:
 *      }
 *  }
 * }
 */

// Start mediasoup -----------------------------------------------------------------------------------------------------

// createWorkers
(async () => {
  for (let i = 0; i < config.mediasoup.numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: config.mediasoup.worker.logLevel,
      logTags: config.mediasoup.worker.logTags,
      rtcMinPort: config.mediasoup.worker.rtcMinPort,
      rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
    });
    worker.on("died", () => {
      logger.error(`Worker died [pid:${worker.pid}]`);
      process.exit(1);
    });
    workers.push(worker);

    // log worker resource usage
    /*setInterval(async () => {
            const usage = await worker.getResourceUsage();

            logger.info('mediasoup Worker resource usage [pid:%d]: %o', worker.pid, usage);
        }, 120000);*/
  }
  setupSocketHandlers(io, roomList, workers, logger);
})();

httpsServer.listen(config.listenPort, () => {
  logger.info('Server', {
    listening: `https://${config.listenIp}:${config.listenPort}?roomId=1&userId=1`,
    mediasoup_server: mediasoup.version,
    node_version: process.versions.node,
  })
});