const EventEmitter = require("events");
const {gen_packet, st_handle} = require("./packet_handler");
const {init_input_tunnels, push_data_to_remote} = require("./server_tunnel");

let e = new EventEmitter;

init_input_tunnels(e);

e.on("data", (num, ss, data) => {
	let kl = data.readUInt8(0);

	let k = st_handle();
	for(let i = 0; i < kl; i++) {
		let pk_send = gen_packet(k(), 3, ss, Buffer.from("hello world" + i));
		push_data_to_remote(pk_send);
	}

	let pk_send = gen_packet(k(), 3, ss, Buffer.from("OK"));
	push_data_to_remote(pk_send);
});

e.on("drain", () => {
	console.log("tunnel on");
})




