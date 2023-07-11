const {init_input_tunnels, push_data_to_remote} = require("./server_tunnel");
const {EventEmitter} = require("events");
const {createConnection} = require("net");
const {gen_packet, st_handle, pk_handle, get_packet} = require("./packet_handler");

const target_addr = "192.168.0.2";
const target_port = 8080;

let e = new EventEmitter;
let pk_handles = {};
let clients = {};
init_input_tunnels(e);

e.on("data", (ss_id, data) => {
	if(pk_handles[ss_id] == undefined) {
		pk_handles[ss_id] = pk_handle((data) => {
			let {type, real_data} = get_packet(data);
			let pkt_type = type;

			if(pkt_type == 101) {
				//创建会话
				let target = real_data.toString().split(",");
				let host = target[0];
				let port = target[1];
				console.log("connect to", host, port, "related to", ss_id);
				create_outbound(target_addr, target_port, ss_id);
			}else if(pkt_type == 3) {
				//数据传输
				if(clients[ss_id] != undefined) {
					if(!clients[ss_id].write(real_data)) {
						push_data_to_remote(gen_packet(clients[ss_id].st(), 204, ss_id, Buffer.alloc(0)));
					}
				}
			}else if(pkt_type == 102) {
				//销毁会话
				console.log("session from client: ", ss_id, "closed unexcpectlly");
				if(clients[ss_id] != undefined && !clients[ss_id].destroyed) {
					clients[ss_id].destroy();
				}
				clients[ss_id]?.resume();
				pk_handles[ss_id] = undefined;
				clients[ss_id] = undefined;
			}else if(pkt_type == 103) {
				//暂停
				//有可能在客户端写出数据时，服务端连接已经关闭
				clients[ss_id]?.pause();
			}else if(pkt_type == 104) {
				clients[ss_id]?.resume();
			}else if(pkt_type == 105) {
				clients[ss_id]?.end();
			}else if(pkt_type == 106) {

			}
		}, ss_id);
	}
	let {pn} = get_packet(data);
	pk_handles[ss_id](pn, data);
});

function create_outbound(host, port, ss_id) {
	let s = createConnection({host, port, allowHalfOpen: true});
	let st = st_handle();
	s.on("connect", () => {
		s.removeAllListeners();

		console.log("session:", ss_id, "connected");

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
		s.on("close", (had_error) => {
			if(had_error) {
				//有错误的情况下，另一端不清楚链接是否已经关闭
				console.log("session:", ss_id, "closed unexcpectlly");
				push_data_to_remote(gen_packet(st(), 203, ss_id, Buffer.alloc(0)));
			}

			clients[ss_id]?.resume();
			clients[ss_id] = undefined;
			pk_handles[ss_id] = undefined;
		});
		s.on("drain", () => {
			push_data_to_remote(gen_packet(st(), 205, ss_id, Buffer.alloc(0)));
		});
		s.on("end", () => {
			push_data_to_remote(gen_packet(st(), 206, ss_id, Buffer.alloc(0)));
		});

	});
	s.on("error", () => {
		console.log("session:", ss_id, "connect failed");
		push_data_to_remote(gen_packet(st(), 201, ss_id, Buffer.alloc(0)));
		pk_handles[ss_id] = undefined;
	});

}

//从服务器流向客户端的链接drain
e.on("drain", () => {
	for(let i in clients) {
		if(clients[i] != undefined) {
			clients[i].resume();
		}
	}
});

