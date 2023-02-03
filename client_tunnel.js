const { randomInt } = require("crypto");
const { readFileSync } = require("fs");
const { connect } = require("tls");
const { recv_handle, mix, gen_packet } = require("./packet_handler");
const { log } = require("./util");

let tunnel_nums = 8;
let target_host = "127.0.0.1";
let target_port = 5000;

/**
 * @var {Array<Socket>} clients
 */
let clients = [];

let pending_data = [];
let drain_emited = false;

function init_tunnels(ecbs) {
    for(let i = 0; i < tunnel_nums; i++) { clients.push(undefined); }

    setInterval(() => {
        for(let i in clients) {
            if(clients[i] != undefined) continue;
            let client = create_tunnel(i, ecbs);
            clients[i] = client;
        }
    }, 1000);
}

function create_tunnel(index, ecbs) {
    let client = connect({
        host: target_host,
        port: target_port,
        ca: [readFileSync("selfsigned-certificate.crt")],
        checkServerIdentity: () => undefined
    }, () => {

        //初始化client
        client.removeAllListeners();

        //发送通道注册包
        let register_packet = gen_packet(0, 10, 0, Buffer.alloc(0));
        client.write(register_packet);


        client.on("error", (err) => {});

        client._authed = false;
        client._recv_handler = recv_handle(data => {
            let pkt_type = data.readUInt8(1 + 3);
            let ss_id = data.readUInt16LE(2 + 3);

            if(pkt_type == 11) {
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
        }).on("close", (hadError) => {
            if(hadError) {
                console.log("connection closed unexcepted !");
            }
            clients[index] = undefined;
        }).on("drain", () => {
            on_tunnel_drain(ecbs);
        });

    });

    client.on("error", (err) => {
        //console.log(err);
        clients[index] = undefined;
    });

    return client;
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
            console.log("失败", data);
            pending_data.push(data);
        }
    });

	return true;
}
module.exports = {init_tunnels, push_data_to_remote}
