var game = function() {
	/*
		We're using Phaser as a 2D game engine for our games.
		I've left it out of here and just grabbed the functions that matter for the context.
		Phaser uses 3 pre-defined functions to load a game scene;
		* Preload - Loads all assets from URLs.
		* Create - Creating sprites, audio, bitmapfonts, etc, before starting the game.
		* Update - The main update loop, targetted at 60fps but device-dependent.

		Phaser automatically calls preload when it's ready.
		Then it calls create when everything in preload has loaded.
		I've included these functions here but with only the parts needed for this fiddle.
	*/

	// Server communication.
	var socket;							// A reference to the server socket connection.
	var stateUpdates = [];				// Array of gamestate updates.
	var gameStartTime = 0;				// Timestamp of the start of the game.
	var firstServerTimestamp = 0;		// Timestamp of the servers game start.
	var RENDER_DELAY = 100;				// An acceptable delay in rendering for a nice and smooth result.

	// Input.
	var lastActionTime = 0;				// Timestamp for previous sent input data.
	var inputActionId = 0;				// For debugging roundtrip time for each input event.
	var inputActions = {};				// For debugging roundtrip time for each input event.

	// Phaser function for preloading all assets before starting the game.
	// function preload() {}

	// Phaser function for creating sprites and such from the preloaded assets.
	function create() {
		connectToSocket();
	}

	function connectToSocket() { // Connect to the socket and fetch initial data.
		// Initiate the socket connection, to the game's given namespace.
		socket = io("server:url", {
			transports: ['websocket']
		});
		socket.on("connect_error", function(_reason) {
			console.log("CONNECTION ERROR!");
			console.log(_reason);
		});
		socket.on('connect', function() {
			console.log("Connected to server.");
		});
		socket.on('message', function(msg) {
			// Handle incoming server data by parsing it and passing it to the message handler function.
			var deserialized = JSON.parse(msg);
			onMessageHandler(deserialized);
		});
	}

	function onMessageHandler(data) {
		// Loads of more events but I've only included the one that matters for the fiddle.
		switch (data.type) {
			case 'onTick':
				processGameUpdate(data);
				break;
			default:
				console.log('No Data Sent');
				console.log(data.type);
				break;
		}
	}

	function serializeData(_type, _value) {
		_value.type = _type;
		return JSON.stringify(_value);
	}

	function sendMessage(_data) {
		socket.compress(true).emit('message', _data);
	}

	// Phaser function. The main update loop. Targetted at 60fps but device-dependent.
	function update(t, dt) {
		dt /= 1000;
		updateInput();
		updateClient(dt);
	}

	function updateInput() {
		var playerOp = {}; // Player operation (registered input).
		if(joystickActive) {
			// getJoystickAngle() - A function that just returns a sprites position relative to another sprites position.
			var jsAngle = getJoystickAngle();
			if(jsAngle != null) {
				playerOp.joystickAngle = Math.round(jsAngle * Phaser.Math.RAD_TO_DEG);
			}
		}
		if (Date.now() - lastActionTime >= 20) {
			lastActionTime = Date.now();

			// Send the player operations for the server to process.
			let inputData = { actionId: inputActionId++, ts: Date.now() };
			inputActions[inputData.actionId] = inputData.ts;

			var data = serializeData('onInput', { playerOp: playerOp, id: inputData });
			sendMessage(data);
		}
	}

	function updateClient(dt) {
		var state = getCurrentState();
		var all = state.all;
		if(!all) { return; }

		all.forEach(function(a) {
			// A function that just checks all players, and self (local client),
			// to get the player object based on the id from the server.
			var p = getPlayerByID(a.playerId);
			if(p == undefined) { return; }

			// Update player position.
			if(!Number.isNaN(a.x) && a.x != undefined) {
				updatePlayerTransform(p, { x: a.x, y: a.y, angle: a.angle });
				if(a.opId) {
					if(inputActions[a.opId.actionId]) {
						var timeForInput = Date.now() - inputActions[a.opId.actionId];
						// console.log("Timestamp: " + inputActions[a.opId.actionId]);
						showInputTimeText(timeForInput);
						delete inputActions[a.opId.actionId];
					}
				}
			}
		});
	}

	function updatePlayerTransform(_player, _data) {
		_player.rotation = _data.angle;
		_player.x = _data.x;
		_player.y = _data.y;
	}

	// Game state functions.
	function getCurrentState() {
		if (!firstServerTimestamp) {
			return {};
		}

		var serverTime = getServerTime();
		var base = getBaseUpdate();

		if (base < 0) {
			return stateUpdates[stateUpdates.length - 1];
		} else if (base === stateUpdates.length - 1) {
			return stateUpdates[base];
		} else {
			var baseUpdate = stateUpdates[base]; // Current applied update state.
			var next = stateUpdates[base + 1]; // Next update state to interpolate values to.
			var r = (serverTime - baseUpdate.t) / (next.t - baseUpdate.t); // Ratio.
			return {
				// Did not include interpolateStateArray() here.
				// What it does is just take each value passed in and interpolates between them by ratio.
				// E.g player position and rotation.
				all: interpolateStateArray(baseUpdate.all, next.all, r)
			};
		}
	}

	function getServerTime() {
		return firstServerTimestamp + (Date.now() - gameStartTime) - RENDER_DELAY;
	}

	function getBaseUpdate() {
		var serverTime = getServerTime();
		for (var i = stateUpdates.length - 1; i >= 0; i--) {
			if (stateUpdates[i].t <= serverTime) {
				return i;
			}
		}
		return -1;
	}

	function processGameUpdate(update) {
		if (!firstServerTimestamp) {
			firstServerTimestamp = update.t;
			gameStartTime = Date.now();
		}

		stateUpdates.push(update);

		// Keep only one game update before the current server time
		var base = getBaseUpdate();
		if (base > 0) {
			stateUpdates.splice(0, base);
		}
	}
};
game();