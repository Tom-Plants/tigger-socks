const socks = require("socksv5");
const md5 = require("md5");
const {gen_packet, pk_handle, st_handle, recv_handle} = require("./packet_handler");
const {createConnection} = require("net");
const EventEmitter = require("events");
const {push_data_to_remote, init_tunnels} = require("./client_tunnel");
const {Stream} = require("stream");


let g_sessions = {};
let pk_handles = {};
let tunnel = new EventEmitter;
let mapper = {};
let server = socks.createServer((info, accept, deny) => {
	console.log("client", info.srcAddr, info.srcPort, "want connect to", info.dstAddr, info.dstPort);

	start_proxy(info.dstAddr, info.dstPort, (tcp) => {
		tcp.on("_connect", () => {
			console.log("remote connected to", info.dstAddr, ":", info.dstPort);

			tcp.removeAllListeners();

			//本地socks5操作
			let c = accept(true);
			mapper[c.remotePort] = c;
			

			c.on("data", (data) => {
				if(!tcp.write(data)) {
					//所有暂停
					for(let i in mapper) {
						if(mapper[i] != undefined) {
							mapper[i].pause();
						}
					}
				}
			});
			c.on("end", () => {
				tcp.end();
			});
			c.on("error", () => {})
			c.on("close", (had_error) => {
				if(had_error) {
					console.log("local", info.dstAddr, ":", info.dstPort, "closed unexcpectlly !");
				}
				tcp.destroy();
				mapper[c.remotePort] = undefined;
			});
			c.on("drain", () => {
				tcp.resume();
			});

			//代理端事件操作
			tcp.on("_data", (data) => {
				if(!c.write(data)){
					tcp.pause();
				}
			});
			tcp.on("_close", (had_error) => {
				if(had_error) {
					console.log("remote", info.dstAddr, ":", info.dstPort, "closed unexcpectlly !");
				}
				if(!c.destroyed) c.destroy();
			});
			tcp.on("_end", () => {
				c.end();
			});
			tcp.on("_drain", () => {
				c.resume();
			});
			tcp.on("_pause", () => {
				c.pause();
			})
		});

		tcp.on("_close", (had_error) => {
			if(had_error) {
				console.log("remote", info.dstAddr, info.dstPort, " connect failed");
			}
			deny();
		});
	});
});

server.listen(1080, "0.0.0.0", () => {
	console.log("server started");
	init_tunnels(tunnel);

	tunnel.on("drain", () => {
		for(let i in mapper) {
			if(mapper[i] != undefined) {
				mapper[i].resume();
			}
		}
	});

	tunnel.on("data", (ss_id, data) => {
		if(pk_handles[ss_id] == undefined) {
			pk_handles[ss_id] = pk_handle((data) => {
				let pkt_type = data.readUInt8(1 + 3);
				let real_data = data.slice(4 + 3);

				if(pkt_type == 202) {
					//创建会话成功
					g_sessions[ss_id].emit("_connect");
				}else if(pkt_type == 201) {
					//创建会话失败
					g_sessions[ss_id].emit("_close", true);
					g_sessions[ss_id] = undefined;
					pk_handles[ss_id] = undefined;
				}else if(pkt_type == 3) {
					//数据流
					g_sessions[ss_id].emit("_data", real_data);
				}else if(pkt_type == 203) {
					//远程会话关闭
					if(g_sessions[ss_id] != undefined) {
						g_sessions[ss_id].emit("_close", false);
						push_data_to_remote(gen_packet(g_sessions[ss_id].st(), 102, ss_id, Buffer.alloc(0)));
					}
				}else if(pkt_type == 204) {
					//远程暂停
					g_sessions[ss_id]?.emit("_pause");
				}else if(pkt_type == 205) {
					//远程恢复
					g_sessions[ss_id]?.emit("_drain");
				}else if(pkt_type == 206) {
					//远程半关
					g_sessions[ss_id]?.emit("_end");
				}else if(pkt_type == 207) {
					//远程关闭已响应
					console.log(ss_id, "closed");
					g_sessions[ss_id] = undefined;
					pk_handles[ss_id] = undefined;
				}
			}, ss_id);
		}
		let pkt_num = data.readUInt32LE(0);
		pk_handles[ss_id](pkt_num, data);
	});
});


function gen_remote_socket(ss_id) {
	let a = new EventEmitter;
	let st = st_handle();
	a.write = (data) => {
		return push_data_to_remote(gen_packet(st(), 3, ss_id, data));
	}
	a.pause = () => {
		push_data_to_remote(gen_packet(st(), 103, ss_id, Buffer.alloc(0)));
	}
	a.resume = () => {
		push_data_to_remote(gen_packet(st(), 104, ss_id, Buffer.alloc(0)));
	}
	a.destroy = () => {
		push_data_to_remote(gen_packet(st(), 102, ss_id, Buffer.alloc(0)));
	}
	a.end = () => {
		push_data_to_remote(gen_packet(st(), 105, ss_id, Buffer.alloc(0)));
	}
	a.connect = (addr, port) => {
		g_sessions[ss_id] = a;
		push_data_to_remote(gen_packet(st(), 101, ss_id, Buffer.from(addr+","+port)));
	}
	a.st = st;
	return a;
}
function start_proxy(addr, port, callback) {
	let server_ss = Object.keys(g_sessions).length;
	for(let i in g_sessions) {
		if(g_sessions[i] == undefined) {
			server_ss = i;
		}
	}
	let socket = g_sessions[server_ss] = gen_remote_socket(server_ss, addr, port)
	socket.connect(addr, port);
	callback(socket);
}

server.useAuth(socks.auth.None());


process.stdin.pipe(
	new Stream.Writable(
		{
			write: (chunk, encoding, callback) => {
				let cmd = chunk.toString();
				if(cmd == "check\r\n") {
					for(let i in g_sessions) {
						if(g_sessions[i] != undefined) {
							console.log(i, g_sessions[i]);
						}
					}
				}
				callback(null);
			}
		}
	)
);
