const {init_input_tunnels, push_data_to_remote} = require("./server_tunnel");
const {EventEmitter} = require("events");
const {createConnection} = require("net");
const {gen_packet, st_handle, pk_handle} = require("./packet_handler");

let e = new EventEmitter;
let pk_handles = {};
let clients = {};
init_input_tunnels(e);

e.on("data", (ss_id, data) => {
	if(pk_handles[ss_id] == undefined) {
		pk_handles[ss_id] = pk_handle((data) => {
            let pkt_type = data.readUInt8(1 + 3);
            let real_data = data.slice(4 + 3);

			if(pkt_type == 101) {
				//创建会话
				let target = real_data.toString().split(",");
				let host = target[0];
				let port = target[1];
				console.log("connect to", host, port, "related to", ss_id);
				create_outbound(host, port, ss_id);
			}else if(pkt_type == 3) {
				//数据传输
				if(clients[ss_id] != undefined) {
					if(!clients[ss_id].write(real_data)) {
						push_data_to_remote(gen_packet(clients[ss_id].st(), 204, ss_id, Buffer.alloc(0)));
					}
				}
			}else if(pkt_type == 102) {
				//销毁会话
				console.log(ss_id, "closed");
				if(clients[ss_id] != undefined && !clients[ss_id].destroyed) {
					clients[ss_id].destroy();
				}
				if(clients[ss_id] != undefined) {
					push_data_to_remote(gen_packet(clients[ss_id].st(), 207, ss_id, Buffer.alloc(0)));
				}
				//响应销毁
				pk_handles[ss_id] = undefined;
				clients[ss_id] = undefined;
			}else if(pkt_type == 103) {
				//暂停
				clients[ss_id].pause();
			}else if(pkt_type == 104) {
				clients[ss_id].resume();
			}else if(pkt_type == 105) {
				clients[ss_id].end();
			}else if(pkt_type == 106) {

			}
		}, ss_id);
	}
	let pkt_num = data.readUInt32LE(0);
	pk_handles[ss_id](pkt_num, data);
});

function create_outbound(host, port, ss_id) {
	let s = createConnection({host, port, allowHalfOpen: true});
	let st = st_handle();
	s.on("connect", () => {
		s.removeAllListeners();

		console.log(host, port, "connected");

		clients[ss_id] = s;
		clients[ss_id].st = st;
		push_data_to_remote(gen_packet(st(), 202, ss_id, Buffer.alloc(0)));

		s.on("data", (data) => {
			if(!push_data_to_remote(gen_packet(st(), 3, ss_id, data))) {
				for(let i in clients) {
					if(clients[i] != undefined) {
						clients[i].pause();
					}
				}
			}
		});
		s.on("error", () => { });
		s.on("close", () => {
			push_data_to_remote(gen_packet(st(), 203, ss_id, Buffer.alloc(0)));
		});
		s.on("drain", () => {
			push_data_to_remote(gen_packet(st(), 205, ss_id, Buffer.alloc(0)));
		});
		s.on("end", () => {
			push_data_to_remote(gen_packet(st(), 206, ss_id, Buffer.alloc(0)));
		});

	});
	s.on("error", () => {
		console.log(host, port, "connect failed");
		push_data_to_remote(gen_packet(st(), 201, ss_id, Buffer.alloc(0)));
		pk_handles[ss_id] = undefined;
	});

}

//从服务器流向客户端的链接drain
e.on("drain", () => {
	for(let i in clients) {
		if(clients[i] != undefined) {
			clients[i].pause();
		}
	}
});
