const { randomInt } = require("crypto");
const { readFileSync } = require("fs");
const { connect } = require("tls");
const { recv_handle, mix, gen_packet } = require("./packet_handler");
const { log } = require("./util");

let tunnel_nums = 10;
let target_host = "us1.0x7c00.site";
let target_port = 443;

/**
 * @var {Array<Socket>} clients
 */
let clients_map = {};

let pending_data = [];
let drain_emited = false;

function init_tunnels(ecbs) {
    setInterval(async () => {
		let need_client = () => {
			let count = 0;
			for(let i in clients_map) {
				if(clients_map[i] != undefined && clients_map[i]._authed == true) {
					count++;
				}
			}
			if(count >= tunnel_nums) {
				return false;
			}
			return true;
		}

		if(need_client()) {
			try {
				let {id, client} = await create_tunnel(ecbs);
				clients_map[id] = client; 
			}catch(err) {
				console.log("create_tunnel failed", err);
			}
		}
    }, 100);
}

function create_tunnel(ecbs) {
	return new Promise((resolve, reject) => {
		let client = connect({
			host: target_host,
			port: target_port,
			ca: [readFileSync("selfsigned-certificate.crt")],
			checkServerIdentity: () => undefined,
			allowHalfOpen: true
		}, () => {

			//初始化client
			client.removeAllListeners();

			//发送通道注册包
			let register_packet = gen_packet(0, 10, 0, Buffer.alloc(0));
			client.write(register_packet);


			client._authed = false;
			client._recv_handler = recv_handle(data => {
				let pkt_type = data.readUInt8(1 + 3);
				let ss_id = data.readUInt16LE(2 + 3);

				if(pkt_type == 11) {
					//通道注册成功,通道注册成功时，ss_id将是多线程通道标识符
					client._authed = true;
					on_tunnel_drain(ecbs);

					client.removeAllListeners();

					client.on("close", (hadError) => {
						if(hadError) {
							console.log("connection closed unexcepted !");
						}
						clients_map[ss_id] = undefined;
					}).on("data", (data) => {
						client._recv_handler(data);
					}).on("drain", () => {
						on_tunnel_drain(ecbs);
					}).on("end", () => {
						if(client._authed == true) {
							console.log("警告，受到旁路FIN包攻击，联系服务器断开连接");
							let finish_ok_packet = gen_packet(0, 11, 0, Buffer.alloc(0));
							client.write(finish_ok_packet);
							client._authed = false;
							client.end();
							client.destroy();
						}else {
							client.end();
						}
					});

					resolve({id: ss_id, client});
				}else if(pkt_type == 8) {
					//结束连接回应
					let finish_ok_packet = gen_packet(0, 9, 0, Buffer.alloc(0));
					client.write(finish_ok_packet);
					client._authed = false;
				}else {
					ecbs.emit("data", ss_id, data);
				}
			});

			client.on("data", (data) => {
				client._recv_handler(data);
			}).on("close", () => {
				//通道在验证前关闭
				console.log("tunnel closed before auth");
			}).on("end", () => {
				client.end();
			}).on("error", (err) => {});

		});

		client.on("error", (err) => {
			reject(err);
		});
	});
}

function get_drain_client() {
    let can_client = [];
    for(let j in clients) {
        let i = clients[j];

        if(i == undefined) continue;
        if(i.writableNeedDrain) continue;
        if(!i._authed) continue;

        can_client.push(i);
    }

    if(can_client.length == 0) {
        return undefined;
    }

    return can_client[randomInt(0, can_client.length)];
}

function on_tunnel_drain(ecbs) {
    let data = undefined;
    while((data = pending_data.shift()) != undefined) {
        let client = get_drain_client();
        if(client == undefined) {
            pending_data.unshift(data);
            break;
        }
        client.write(data, (err) => {
            if(err) {
                console.log("错误", data);
                pending_data.unshift(data);
            }
        })
    }

    if(get_drain_client() != undefined && !drain_emited) {
		ecbs.emit("drain");
		drain_emited = true;
    }
}

function push_data_to_remote(data) {
    let client = get_drain_client();
    if(client == undefined) {
        pending_data.push(data);
		drain_emited = false;
        return false;
    }

    client.write(data, (err) => {
        if(err) {
            pending_data.unshift(data);
        }
    });

	return true;
}
module.exports = {init_tunnels, push_data_to_remote}
