// Load modules
var path = require('path');
var db = require('./src/js/db.js');
var cryptom = require('crypto');
var net = require('net');
var JsonSocket = require('json-socket');
var socket = new JsonSocket(new net.Socket());
var nacl = require('./src/js/lib/nacl.js');
var BigNumber = require('bignumber.js');
var bigInt = require("big-integer");
var https = require('https');
var RaiWallet = require('./src/js/rai-wallet/Wallet');
var Block = require('./src/js/rai-wallet/Block');

// Get BrowserWindow.
const {remote} = require('electron');
const {BrowserWindow} = remote;

// Configure RaiLightServer:

var port = 7077;
var host = '127.0.0.1';

// Load default (and global) variables:
var wallet;
var accounts;
var addresses = [];
var balance;
var price;
var walletloaded = false;
var myaddress;
var txhistory;
var currentPage;

// WALLET LOAD
db.getWallet(function(exists, pack) {
	if (exists) {
		PageLoad("login");
		BrowserWindow.getAllWindows()[0].show();
	} else {
		PageLoad();
	}
});

// Connect to RaiLightServer (yes, will be decentralized, later)
function startConnection() {
	socket.connect(port, host);
}
startConnection();

// If can't connect, try again (and again.. again..)
socket.on('error', function(err) {
	console.log("Error when try connect to the server: "+err.message);
	setTimeout(startConnection, 5000);
});

// Sure it will run after the wallet is loaded
walletLoaded(function (){
	var accounts = wallet.getAccounts();
	// Push all addresses to array
	for(let i in accounts) {
		addresses.push(accounts[i].account);
	}
	registerAddresses();
});

function registerAddresses() {
	socket.sendMessage({requestType: "registerAddresses", addresses: addresses});
}

// On RaiLightServer connection
socket.on('connect', function() {
	console.log("Connected to the default server!");

	// Sure it will run after the wallet is loaded
	walletLoaded(function (){
		registerAddresses();
	});
	// Get first Blocks Count
    socket.sendMessage({requestType: "getBlocksCount"});

	// Handle RaiLightServer responses
    socket.on('message', function(r) {
		// If BlocksCount
		if (r.type == "BlocksCount") {
			// Update on GUI
			$("#block").html("Block: "+r.count);
		// If BalanceUpdate or Balance (deprecated)
		} else if (r.type == "balanceUpdate" || r.type == "Balance") {
			// Sure it will run after the wallet is loaded
			walletLoaded(function () {
				// Save wallet
				db.saveWallet(wallet.pack());
				// Get PendingBlocks to PoW ;)
				socket.sendMessage({requestType: "getPendingBlocks", addresses: addresses});
				// Set balance;
				balance = new BigNumber(r.balance).dividedBy('1e+30');
				wallet.setAccountBalancePublic(r.balance, addresses[0]);
				// Set transaction history
				txhistory = wallet.getLastNBlocks(parseXRBAccount(addresses[0]), 100, 0);
			});

		} else if (r.type == "PendingBlocks") {
			// Add pending blocks to PoW
			Object.keys(r.blocks).forEach(function(account){
				Object.keys(r.blocks[account]).forEach(function(hash){
					try {
						wallet.addPendingReceiveBlock(hash, account, r.blocks[account][hash].source, r.blocks[account][hash].amount);
						db.saveWallet(wallet.pack());
					// Catch error, for debug
					} catch(e) {console.log(err);}
				});
			});

		}
    });
});

// EVENTS

// Close the app on button close click
$("#closebtn").click(function() {
	if (walletloaded) {
		db.saveWallet(wallet.pack());
	}
	var window = BrowserWindow.getFocusedWindow();
	window.close();
});

// Minimise the app on button close click
$("#minbtn").click(function() {
	var window = BrowserWindow.getFocusedWindow();
	window.minimize();
});

function PageLoad(page) {
	$("#homebtn").removeClass('active hidden');
	$("#receivebtn").removeClass('active hidden');
	$("#sendbtn").removeClass('active hidden');
	$("#settings").removeClass('active hidden');
	$("#content").empty();
	switch (page) {
		case "receive":
			currentPage = "receive";
			$("#receivebtn").addClass('active');
			$("#content").load("pages/receive.pg");
			break;
		case "send":
			currentPage = "send";
			$("#sendbtn").addClass('active');
			$("#content").load("pages/send.pg");
			break;
		case "home":
			currentPage = "home";
			$("#homebtn").addClass('active');
			$("#content").load("pages/home.pg");
			break;
		case "login":
			currentPage = "login";
			$("#homebtn").addClass('hidden');
			$("#receivebtn").addClass('hidden');
			$("#sendbtn").addClass('hidden');
			$("#content").load("pages/login.pg");
			break;
		case "settings":
			currentPage = "settings";
			$("#settingsbtn").addClass('active');
			$("#content").load("pages/settings.pg");
			break;
		default:
			currentPage = "create";
			$("#homebtn").addClass('hidden');
			$("#receivebtn").addClass('hidden');
			$("#sendbtn").addClass('hidden');
			$("#content").load("pages/create.pg");
	}
}

$("#homebtn").click(function() {
	if (walletloaded) {
		if (currentPage != "home") {
			PageLoad("home");
		}
	}
});

$("#receivebtn").click(function() {
	if (walletloaded) {
		if (currentPage != "receive") {
			PageLoad("receive");
		}
	}
});

$("#sendbtn").click(function() {
	if (walletloaded) {
		if (currentPage != "send") {
			PageLoad("send");
		}
	}
});

$("#settingsbtn").click(function() {
	if (walletloaded) {
		if (currentPage != "settings") {
			PageLoad("settings");
		}
	}
});

// FUNCTIONS

// Encrypt using aes-256-cbc
function encrypt(text, password){
	var cipher = cryptom.createCipher('aes-256-cbc',password);
	var crypted = cipher.update(text,'utf8','hex');
	crypted += cipher.final('hex');
	return crypted;
}

// Decrypt using aes-256-cbc
function decrypt(text, password){
	var decipher = cryptom.createDecipher('aes-256-cbc',password);
	var dec = decipher.update(text,'hex','utf8');
	dec += decipher.final('utf8');
	return dec;
}

// Sure it will run after the wallet is loaded
function walletLoaded(cb) {
	if (walletloaded) {
		cb();
	} else {
		setTimeout(walletLoaded, 100, cb);
	}
}

// Broadcast blocks to the network
function broadcastBlock(blk){
	var json = blk.getJSONBlock();
	var hash = blk.getHash(true);
	console.log(hash);
	var guiHash;
	if(blk.getType() == 'open' || blk.getType() == 'receive')
		guiHash = blk.getSource();
	else
		guiHash = blk.getHash(true);
    socket.sendMessage({requestType: "processBlock", block: json});
    socket.on('message', function(r) {
		if (r.type == "processResponse") {
			wallet.removeReadyBlock(hash);
		}
	});
}

// Load Chain
function checkChains(cb) {
	var check = {};
	for (var i in accounts) {
		if (accounts[i].lastHash === false) check.push(accounts[i].account);
		console.log(accounts[i].account);
	}
	socket.sendMessage({requestType: "getChain", address: myaddress, count: "1000"});
    socket.on('message', function(r) {
		if (r.type == "Chain") {
			var blocks = r.blocks;

			if(blocks) {
				index = Object.keys(blocks);
				index.reverse();

				index.forEach(function(val, key){
					try{
						var blk = new Block();
						blk.buildFromJSON(blocks[val].contents);
						blk.setAccount(myaddress);
						blk.setAmount(blocks[val].amount);
						blk.setImmutable(true);
						wallet.importBlock(blk, myaddress, false);
					}catch(e){
						console.log(e);
					}

				});
				wallet.useAccount(myaddress);
				cb();

			} else {
				cb();
			}
		}
	});
}

// Local PoW
function clientPoW() {
	var pool = wallet.getWorkPool();
	var hash = false;
	if(pool.length > 0) {
		for(let i in pool) {
			if(pool[i].needed ||!pool[i].requested) {
				hash = pool[i].hash;
				break;
			}
		}
		if(hash === false) {
			return setTimeout(clientPoW, 200);
		}
		pow_workers = pow_initiate(NaN, 'src/js/pow/');
		pow_callback(pow_workers, hash, function() {
			console.log('Working locally on ' + hash);
		}, function(work) {
			console.log('PoW found for ' + hash + ": " + work);
			wallet.updateWorkPool(hash, work);
			setTimeout(clientPoW, 200);
			checkReadyBlocks();
			txhistory = wallet.getLastNBlocks(parseXRBAccount(addresses[0]), 100, 0);
			console.log("Trying to broadcast");
			function checkReadyBlocks(){
				console.log("checkReadyBlocks");
				var blk = wallet.getNextReadyBlock();
				if(blk !== false) {
					console.log("broadcasting");
					broadcastBlock(blk);
				} else {
					setTimeout(checkReadyBlocks, 500);
				}
			}
		});
	} else {
		setTimeout(clientPoW, 200);
	}
}

// Get coinmarketcap price every 20 seconds
function getPrice() {
	https.get('https://api.coinmarketcap.com/v1/ticker/raiblocks/', (res) => {
		let body = "";
		res.on("data", data => {
			body += data;
		});
		res.on("end", () => {
			body = JSON.parse(body);
			price = body[0].price_usd;
			setTimeout(getPrice, 20000);
		 });
	});
}
getPrice();