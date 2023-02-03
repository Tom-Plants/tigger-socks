const EventEmitter = require("events");
const {gen_packet, st_handle} = require("./packet_handler");
const {init_input_tunnels, push_data_to_remote} = require("./server_tunnel");

let e = new EventEmitter;
let waiting = false;

init_input_tunnels(e);

e.on("data", async (ss, data) => {
	let real_data = data.slice(4+3);
	let kl = real_data.readUInt8(0);

	let k = st_handle();
	for(let i = 0; i < kl;) {
		if(waiting){
			await sleep(10);
			continue;
		}
		let pk_send = gen_packet(k(), 3, ss, Buffer.from("hello world" + i));
		if(!push_data_to_remote(pk_send)) {
			waiting = true;
			console.log("节流");
		}else {i++};
	}

	let pk_send = gen_packet(k(), 3, ss, Buffer.from("OK"));
	push_data_to_remote(pk_send);
});

e.on("drain", () => {
	waiting = false;
	console.log("取消节流");
});

async function sleep(sec) {
	return new Promise((res) => {
		setTimeout(() => {res()}, sec);
	});
}


