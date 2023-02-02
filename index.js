const socks = require("socksv5");
const md5 = require("md5");

let server = socks.createServer((info, accept, deny) => {
	console.log("client", info.srcAddr, info.srcPort, "want connect to", info.dstAddr, info.dstPort);

	let id = info.srcAddr+info.srcPort+info.dstAddr+info.dstPort;
	let session = md5(id).slice(8, 24); //16位小写md5

	start_proxy(session, info.dstAddr, info.dstPort, (tcp, udp) => {
		tcp.on("_connect", () => {
			console.log("remote connected to", info.dstAddr, ":", info.dstPort);

			//本地socks5操作
			let c = accept(true);

			c.on("data", (data) => {
				if(!tcp.write(data)) {
					c.pause();
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
				c.destroy();
			});
			tcp.on("_end", () => {
				c.end();
			});
			tcp.on("_drain", () => {
				c.resume();
			});
		});

		tcp.on("_error", () => {
			console.log("remote", info.dstAddr, info.dstPort, " connect failed");
			deny();
		});
	});
});

server.listen(1080, "192.168.123.124", () => {
	console.log("server started");
});

function start_proxy(session, addr, port, callback) {
	
}

server.useAuth(socks.auth.None());
