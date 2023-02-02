const {randomInt} = require("crypto");
const EventEmitter = require("events");
const {init_tunnels, push_data_to_remote} = require("./client_tunnel");
const {gen_packet, pk_handle} = require("./packet_handler");

let ll = {};
let e = new EventEmitter;
let can_patching_new = true;
init_tunnels(e);

e.on("data", (num, ss, data) => {
	if(ll[ss] == undefined) {
		ll[ss] = pk_handle(data => {
			recive(data, ss) 
		}, ss);
	}
	ll[ss](num, data);
});

function recive(data, ss) {
	if(data.toString() == "OK") {
		console.log("order", ss, "success");
		ll[ss] = undefined;
	}
}

let buf = Buffer.alloc(1);
buf.writeUInt8(randomInt(1, 5));
let count = 0;

async function order() {
	if(can_patching_new) {
		console.log("patching order:", count);
		let pk1 = gen_packet(0, 3, count, buf);
		can_patching_new = push_data_to_remote(pk1);
		count++;
	}else {
		console.log("ordering ... waiting ...");
	}
	setTimeout(() => {
		order();
	}, randomInt(100, 10000));
}
order();

e.on("drain", () => {
	can_patching_new = true;
});
