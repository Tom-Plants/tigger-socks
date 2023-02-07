const { randomInt } = require("crypto");
const { readFileSync } = require("fs");
const { connect } = require("tls");
const { recv_handle, mix, gen_packet } = require("./packet_handler");
const { log } = require("./util");

let tunnel_nums = 8;
let target_host = "jp1.0x7c00.site";
let target_port = 443;

/**
 * @var {Array<Socket>} clients
 */
let clients = {};

let pending_data = [];
let drain_emited = false;

async function init_tunnels(ecbs) {
	for(let i=0; i< tunnel_nums; i++) {
		clients[i] = undefined;
	}

	let sleep = (sec) => {
		return new Promise((resolve) => {
			setTimeout(() => {resolve()}, sec);
		});
	}

	while(true) {
		await sleep(100);
		for(let i in clients) {
			if(clients[i] == undefined) {
				await create_tunnel(ecbs);
				break;
			}
		}
	}
}

async function create_tunnel(ecbs) {
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
					clients[ss_id] = client;
					client.on("close", (hadError) => {
						if(hadError) {
							console.log("connection closed unexcepted !");
						}
						clients[ss_id] = undefined;
					});
					//通道注册成功
					client._authed = true;
					on_tunnel_drain(ecbs);
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
			}).on("error", (err) => {});
		});

		client.on("error", (err) => {
			//clients[index] = undefined;
			console.log(err);
		});

		return client;

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
