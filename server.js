const express = require("express");
const app = express();
const https = require('https');
const port = process.env.PORT || 3000;
const customParser = require('socket.io-msgpack-parser');
const io_redis = require('socket.io-redis');
const redis = require('redis');
const pub = redis.createClient(""); // Uses a connection URL to our redis server.
const sub = pub.duplicate(); // Redis sub client.

const updateRate = 1000 / 30;

var updateGameStates; // Interval that calls an update function based on updateRate.
var server;
var io;
var gameInstanceReference;
var gameNamespace;

function initServer() {
	// Set up express.
	app.get('/', function (req, res) {
		res.end('');
	});

	// Live server uses https certificates here, replaced with empty strings now.
	server = https.Server({key: "", cert: ""}, app);

	// Start socketio.
	io = require('socket.io')(server, {
		parser: customParser,
		serveClient: false,
		transports: ['websocket']
	});

	// Attach redis adapter.
	// All this is for using multiple socket nodes, not needed for this fiddle.
	// io.adapter(io_redis({ pubClient: pub, subClient: sub }));
	// sub.on('message', handleMessages);
	// sub.subscribe('roomUpdate');

	// We are ready to listen.
	server.listen(port, () => {
		console.log(`Server is running and listening on port ${port}.`);
	});

	// Set up all the games.
	setGames();

	// Start the update timer.
	updateGameStates = setInterval(updateState, updateRate, this);
}

function setGames() {
	// Require and instantiate the game.
	gameInstanceReference = require('./server/game.js').Game();
	gameNamespace = io.of('/game');

	// Set up a connection listener.
	gameNamespace.on('connect', socket => onConnection(socket));
}

function updateState() {
	gameInstanceReference.updateGameState();
}

function handleMessages(msg) {
	// Parse the incoming client message.
	msg = JSON.parse(msg);

	// Check the message type to deduce which function to call.
	switch(msg.type) {
		case 'update':
			gameInstanceReference.messageHandler(msg);
			break;
		// More cases here but for other server and client stuff.
		// Like redis, pm2 workers, etc.
	}
}

function onConnection(socket) {
	// Set up a generic event listener.
	socket.on('message', msg => {
		handleMessages(msg);
	});

	socket.on("ping", (cb) => {
		if (typeof cb === "function") {
			cb();
		}
	});

	gameInstanceReference.onConnect(socket.id);
}

function publishMessage(_type, _value) {
	let data = {
		type: _type,
		value: _value
	};

	// Sending messages to clients via redis.
	this.pub.publish('roomUpdate', JSON.stringify(data));
};

// Start the server.
initServer();