const { randomInt } = require("crypto");
const { readFileSync } = require("fs");
const { createServer } = require("tls");
const { log } = require("./util");
const { recv_handle, gen_packet } = require("./packet_handler");

let port = 5000;
let host = "0.0.0.0";

let clients = [];

let pending_data = [];
let drain_emited = false;

function init_input_tunnels(ecbs) {
    createServer({
        key: readFileSync("selfsigned-key.key"),
        cert: readFileSync("selfsigned-certificate.crt")
    }).listen(port, host).on("secureConnection", (socket) => {
        log(`T`, socket.remoteAddress, socket.remotePort, 0, "connected");
        let recv_handler = recv_handle(data => {
            let pkt_num = data.readUInt32LE(0);
            let pkt_type = data.readUInt8(1 + 3);
            let ss_id = data.readUInt16LE(2 + 3);
            let real_data = data.slice(4 + 3);

            if(pkt_type == 10) {
				let id = add_client(socket);
                //发送通道注册成功包
                let register_packet = gen_packet(0, 11, id, Buffer.alloc(0));
                socket.write(register_packet);

                socket._authed = true;
                on_tunnel_drain(ecbs);


				//断开连接
                setTimeout(() => {
                    let finish_packet = gen_packet(0, 8, 0, Buffer.alloc(0));
                    socket.write(finish_packet);
                    socket._authed = false;
                }, randomInt(10, 20) * 1000);
            }else if(pkt_type == 9) {
				//接受到客户端的断开连接请求
                socket.end();
			}else if(pkt_type == 11) {
                //接收到客户端被攻击紧急要求撤销链接请求
                console.log("收到来自客户端的紧急撤销");
                socket._authed = false;
                socket.destroy();
            }else {
                //数据流
				ecbs.emit("data", ss_id, data);
			}
        });


        socket.on("close", (hadError) => {
			if(hadError) {
				console.log("tunnel closed unexpected !")
			}
			clients[id] = undefined;
        })
        .on("data", (data) => {
            recv_handler(data);
        })
        .on("error", (err) => {
            //console.log(err);
        })
        .on("drain", () => {
            on_tunnel_drain(ecbs);
        })
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

function add_client(socket) {
    let id = -1;
    socket._authed = false;
    for(let i in clients) {
        if(clients[i] == undefined) {
            clients[i] = socket;
            id = parseInt(i);
            break;
        }
    }
    if(id == -1) {
        id = clients.push(socket) - 1;
    }
    return id;
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

module.exports = {
    init_input_tunnels,
    push_data_to_remote
}
