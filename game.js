/*
	Server game code.
	Structured this way because we host multiple games running on the same socket server.
*/

var Gamename = function Gamename() {
	// Server & SocketIo references.
	this.io;
	this.nsp;
	this.server;

	// Constants.
	this.RENDER_DELAY = 100;
	this.NEARBY_PLAYERS_RANGE = 1500 * 1500;		// How near players need to be for more accurate update data.
	this.ANGULAR_TOLERANCE = 64;					// Angular tolerance. (Previously 7)
	this.ANGLE_SPEED = 450;							// Angular velocity speed in degrees per second. (Previously 420)
	this.PLAYER_MOVE_SPEED = 180;					// Movement in pixels per second.
	this.DEG_TO_RAD = Math.PI / 180;				// Radian converstions.

	// Game server settings.
	this.players = {};								// An object containing all player objects (connected clients only).
	this.connectedPlayers = 0;						// A counter of connected players.

	// Server update variables.
	this.lastUpdateTime = Date.now();				// Used to calculate deltaTime.
}; exports.Game = Gamename;

Gamename.prototype.onConnect = function(_socketId) { // A connecting client!
	this.connectedPlayers++;

	// Set up the player object and fill it with default data.
	let player = {
		// Server data:
		socketId: _socketId,

		// Game data:
		x: 0,
		y: 0,
		angularVelocity: 0,	// How much to turn each tick.
		angle: 0,
		op: null,			// Player operations received from client.
		updates: {},		// All updates relevant to the player.
		globalUpdates: {}	// All updates relevant to all the players.
	};
	this.players[_socketId] = player;

	this.initPlayer(player);
	this.setClientEvents(player); // Sends current gameworld data to the new client (other players, obstacles, etc).
};

Gamename.prototype.initPlayer = function(player) { // Initialize player.
	// Set up spawn positions and angles.
	this.setRandomSpawnPosition(player);

	// Apply these to be sent with the next update.
	this.setPlayerUpdate(player, this.PLAYER_UPDATE.X, Math.round(player.x));
	this.setPlayerUpdate(player, this.PLAYER_UPDATE.Y, Math.round(player.y));
	this.setPlayerUpdate(player, this.PLAYER_UPDATE.ANGLE, player.angle);
};

// Server event functions.
Gamename.prototype.sendMessage = function(_socketId, _data) {
	this.nsp.to(_socketId).emit('message', _data);
};

Gamename.prototype.broadcastMessage = function(_data) {
	let keys = Object.keys(this.players);
	keys.forEach(p => {
		this.sendMessage(p, _data);
	});
};

Gamename.prototype.serializeData = function(_type, _value) {
	_value.type = _type;
	return JSON.stringify(_value);
};

// Server state update functions.
Gamename.prototype.updateGameState = function() { // Server tick.
	// Calculate time elapsed
	let now = Date.now();
	let dt = (now - this.lastUpdateTime) / 1000;
	this.lastUpdateTime = now;

	let playerKeys = Object.keys(this.players);
	if(playerKeys.length == 0) { return; }

	// Player updates.
	this.applyPlayerOperations(playerKeys, dt);
	this.applyPlayerMovement(playerKeys, dt);

	if(this.shouldSendUpdate) {
		this.sendUpdateState(this, playerKeys);
		this.shouldSendUpdate = false;
	} else {
		this.shouldSendUpdate = true;
	}
};

Gamename.prototype.applyPlayerOperations = function(_ids, dt) { // Handle player input operations.
	for (let i = 0, len = _ids.length; i < len; i++) {
		let player = this.players[_ids[i]];

		if(!player.active) { continue; }
		let op = player.op;
		if(op && player.op && player.op.id) {
			// For debugging the roundtrip time for each input event.
			player.opId = player.op.id;
		}

		// Check input for turning.
		if(op) {
			if(op.joystickAngle) {
				let diff = op.joystickAngle - player.angle;
				diff = Math.abs(diff) >= 180 ? -diff : diff;
				player.angularVelocity = diff > 0 ? this.ANGLE_SPEED : -this.ANGLE_SPEED;
				if (this.withinTolerance(diff)) {
					player.angularVelocity = 0;
					player.angle = Math.round(op.joystickAngle);
				} else {
					player.angularVelocity = diff > 0 ? this.ANGLE_SPEED : -this.ANGLE_SPEED;
				}
			}
		}

		// Calculate the movement vector based on angle and speed constants.
		let moveVector = new this.SAT.Vector(
			Math.cos(player.angle * this.DEG_TO_RAD),
			Math.sin(player.angle * this.DEG_TO_RAD)
		);

		moveVector.x *= this.PLAYER_MOVE_SPEED;
		moveVector.y *= this.PLAYER_MOVE_SPEED;

		move.x += moveVector.x;
		move.y += moveVector.y;
	}
};

Gamename.prototype.applyPlayerMovement = function(_ids, dt) { // Apply movement vector and angular velocity to each player's position and angle.
	for (let i = 0, len = _ids.length; i < len; i++) {
		let player = this.players[_ids[i]];
		
		if(player.dead || !player.active) { continue; }

		let move = player.movement;

		// Apply movement to the players position.
		player.x += move.x * dt;
		player.y += move.y * dt;
		player.angle = Math.round(this.wrapAngle(player.angle + player.angularVelocity * dt, -180, 180));

		// Reset the movement vector.
		move.x = 0;
		move.y = 0;
		player.angularVelocity = 0;
	}
};

Gamename.prototype.sendUpdateState = function(this, playerKeys) {
	for (let i = 0, len = playerKeys.length; i < len; i++) {
		let player = this.players[playerKeys[i]];
		player.nearbyFilter = this.infoFilter(player);
		player.globalFilter = this.infoFilter(player, true);
	}

	// Broadcast the new gamestate to each player.
	for (let i = 0, len = playerKeys.length; i < len; i++) {
		let player = this.players[playerKeys[i]];
		let state = this.createUpdateState(player);
		let data = this.serializeData('onTick', state);
		this.sendMessage(player.socketId, data);
	}

	// Update the array incase anyone died.
	playerKeys = Object.keys(this.players);

	// Clear everything.
	for (let i = 0, len = playerKeys.length; i < len; i++) {
		let player = this.players[playerKeys[i]];
		player.nearbyFilter = null;
		player.globalFilter = null;
		player.updates = {};
		player.globalUpdates = {};
	}
};

Bumper.prototype.createUpdateState = function(player) { // Create an update state catered to a specific player.
	let all = [];
	let keys = Object.keys(this.players);
	for (let p = 0, len = keys.length; p < len; p++) {
		let playerB = this.players[keys[p]];
		if(playerB !== player) {
			if(this.distanceBetween(player, playerB) <= this.NEARBY_PLAYERS_RANGE) {
				all.push(playerB.nearbyFilter);
			} else {
				all.push(playerB.globalFilter);
			}
		}
	}
	all.push(player.nearbyFilter);

	let state = {
		t: Date.now(),
		all: all
	};
	return state;
};

Bumper.prototype.distanceBetween = function(a, b) { // Used to calculate which players are nearby, to limit data sent to each client.
	let dx = a.x - b.x;
	let dy = a.y - b.y;
	return (dx * dx + dy * dy);
};

// Other functions.
Gamename.prototype.infoFilter = function(player, global) { // Filtering what data to send from the playerobject.
	let data = {
		playerId: player.playerId
	};

	let globalUpdates = Object.keys(player.globalUpdates);
	for (let i = 0, len = globalUpdates.length; i < len; i++) {
		let thisGlobal = globalUpdates[i];
		data[thisGlobal] = player.globalUpdates[thisGlobal];
	}

	// Returns only the globally relevant data.
	if(global) {
		return data;
	}

	// Add bare minimum data to send each tick.
	data.angle = player.angle;
	data.x = Math.round(player.x);
	data.y = Math.round(player.y);
	if(player.opId) {
		data.opId = player.opId;
	}

	// Check if any updates have been made that needs to be sent.
	let updates = Object.keys(player.updates);
	if(updates.length > 0) {
		for (let i = 0, len = updates.length; i < len; i++) {
			let thisData = updates[i];
			data[thisData] = player.updates[thisData];
		}
	}

	return data;
};

Gamename.prototype.setPlayerUpdate = function(player, type, value, global) {
	if(global) {
		player.globalUpdates[type] = value;
	} else {
		player.updates[type] = value;
	}
};

// Helper functions.
Gamename.prototype.withinTolerance = function(a) {
	return (Math.abs(a) <= this.ANGULAR_TOLERANCE);
};

Gamename.prototype.wrapAngle = function(value, min, max) {
	let range = max - min;
	return (min + ((((value - min) % range) + range) % range));
};