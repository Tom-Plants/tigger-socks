const socks = require("socksv5");
const md5 = require("md5");
const {gen_packet, pk_handle, st_handle, recv_handle, get_packet} = require("./packet_handler");
const {createConnection, createServer} = require("net");
const EventEmitter = require("events");
const {push_data_to_remote, init_tunnels} = require("./client_tunnel");
const {Stream} = require("stream");
const {writeFileSync, createWriteStream} = require("fs");

const local_host = "0.0.0.0";
const local_port = 27015;

let g_sessions = {};
let pk_handles = {};
let tunnel = new EventEmitter;
let mapper = {};

setInterval(() => {
	console.log("-----------start-----------");
	for(let i in mapper) {
		let s = mapper[i];
		console.log(i, s?.bytesRead, s?.bytesWritten);
	}
	console.log("------huan");
	for(let i in g_sessions) {
		let s = g_sessions[i];
		console.log(i, s==undefined? false: true);
	}
	console.log("-----------st op-----------");
}, 500);

let server = createServer({allowHalfOpen: true, pauseOnConnect: true, keepAlive: true}, (c) => {
	let m_id = md5(c.remoteAddress+c.remotePort);
	start_proxy((tcp) => {
		tcp.on("_connect", () => {
			tcp.removeAllListeners();

			c.resume();
			//本地socks5操作
			mapper[m_id] = c;
			
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
					console.log(`session:`, m_id, "closed unexcpectlly !");
					tcp.destroy();
				}
				tcp.clean();
				mapper[m_id]?.resume();
				mapper[m_id] = undefined;
				delete mapper[m_id];
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
					console.log(`session from remote:`, m_id, "closed unexcpectlly !");
				}
				mapper[m_id]?.resume();
				mapper[m_id] = undefined;
				if(!c.destroyed) c.destroy();
				tcp.clean();
				delete mapper[m_id];
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
			c.destroy();
		});
	}, m_id);
	
});

server.listen(local_port, local_host, () => {
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
				let {type, real_data} = get_packet(data);
				let pkt_type = type;

				if(pkt_type == 202) {
					//创建会话成功
					console.log(`session:`, ss_id, "connected");
					g_sessions[ss_id]?.emit("_connect");
				}else if(pkt_type == 201) {
					//创建会话失败
					g_sessions[ss_id]?.emit("_close", true);
					g_sessions[ss_id] = undefined;
					pk_handles[ss_id] = undefined;
				}else if(pkt_type == 3) {
					//数据流
					g_sessions[ss_id]?.emit("_data", real_data);
				}else if(pkt_type == 203) {
					//远程会话关闭
					console.log("session", ss_id, " connect failed");
					g_sessions[ss_id]?.emit("_close", true);
					g_sessions[ss_id] = undefined;
					pk_handles[ss_id] = undefined;
				}else if(pkt_type == 204) {
					//远程暂停
					g_sessions[ss_id]?.emit("_pause");
				}else if(pkt_type == 205) {
					//远程恢复
					g_sessions[ss_id]?.emit("_drain");
				}else if(pkt_type == 206) {
					//远程半关
					g_sessions[ss_id]?.emit("_end");
				}
			}, ss_id);
		}
		let {pn} = get_packet(data);
		pk_handles[ss_id](pn, data);
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
	a.connect = () => {
		g_sessions[ss_id] = a;
		push_data_to_remote(gen_packet(st(), 101, ss_id, Buffer.alloc(0)));
	}
	a.clean = () => {
		g_sessions[ss_id] = undefined;
		pk_handles[ss_id] = undefined;
	}
	a.st = st;
	return a;
}
function start_proxy(callback, m_id) {
	let socket = g_sessions[m_id] = gen_remote_socket(m_id);
	console.log(`client redirect session:`, m_id);
	socket.connect();
	callback(socket);
}

process.stdin.pipe(
	new Stream.Writable(
		{
			write: (chunk, encoding, callback) => {
				let cmd = chunk.toString();
				if(cmd == "check\n") {
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

