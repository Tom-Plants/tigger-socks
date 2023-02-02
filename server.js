module.exports = {
    on_tunnel_data_recive,
    resume_all_mapper,
    pause_all_mapper,
    create_outbound,
    socket_data,
    focus_close_session,
    session_pause,
    session_resume
}

let host = "localhost";
let port = 444;

let mapper = {};

const { unlinkSync } = require('fs');
const net = require('net');
const { mix, gen_packet } = require('./packet_handler');
const { init_input_tunnels, push_data_to_remote } = require('./server_tunnel');
const { log } = require('./util');
const ph = require("./packet_handler").pk_handle;
const st = require("./packet_handler").st_handle;

let sessions = new Map();

function start() {
    //创建tunnel监听服务器
    init_input_tunnels();

    // setInterval(() => {
    //     console.log("vvvvvvvvvvvvvvvvvvvvvvv")
    //     for(let i in mapper) {
    //         if(mapper[i] != undefined) {
    //             console.log(i, mapper[i].s.localPort, ">>", mapper[i].s.remotePort)
    //         }
    //     }
    //     console.log("^^^^^^^^^^^^^^^^^^^^^^^")
    // }, 100);
}
start();

function pause_all_mapper() {
    for(let i in mapper) {
        if(mapper[i] == undefined) {
            return;
        }
        mapper[i].s.pause();
    }
}

function resume_all_mapper() {
    for(let i in mapper) {
        if(mapper[i] == undefined) {
            return;
        }
        mapper[i].s.resume();
    }
}

/**
 * 会话数据到来
 * @param {Buffer} data 
 * @param {number} ss_id 
 * @param {number} pkt_num 
 */
function socket_data(data, ss_id, pkt_num) {
    if(sessions.has(ss_id)) {
        let socket = sessions.get(ss_id);
        if(data.length == 4) {
            if(data.toString() == "HALF") {
                log(ss_id, socket.localAddress, socket.localPort, pkt_num, `recive FIN from CLIENT`);
                socket.end();
                return;
            }else if(data.toString() == "STOP") {
                log(ss_id, socket.localAddress, socket.localPort, pkt_num, `stop from CLIENT`);
                socket.pause();
                return;
            }else if(data.toString() == "CUNT") {
                log(ss_id, socket.localAddress, socket.localPort, pkt_num, `continue from CLINET`);
                socket.resume();
                return;
            }
        }
        log(ss_id, socket.localAddress, socket.localPort, pkt_num, `>>> ${data.toString("hex").slice(0, 10)}`);
        if(false == socket.write(data)) {
            //这里节流
        }
    }else {
        //异常情况
    }
}

function create_outbound(ss_id) {
    if(!sessions.has(ss_id)) {
        let socket = net.createConnection({host, port, allowHalfOpen: true}, () => {
            let auth_success = gen_packet(0, 1, ss_id, Buffer.alloc(0));
            push_data_to_remote(auth_success);
            log(ss_id, socket.localAddress, socket.localPort, 0, "authed !")
            socket._localAddress = socket.localAddress;
            socket._localPort = socket.localPort;
        });

        sessions.set(ss_id, socket);

        socket._send_handle = st();
        socket._recv_handle = ph(socket_data, ss_id);

        socket.on('data', (data) => {
            let cur = socket._send_handle();
            let packet = gen_packet(cur, 3, ss_id, data);
            push_data_to_remote(packet);
            log(ss_id, socket.localAddress, socket.localPort, cur, `<<< ${data.toString("hex").slice(0, 10)}`);
        }).on("close", (hadError) => {
            if(hadError) {
                log(ss_id, socket._localAddress, socket._localPort, 0, "closed unexpected !"); 

                let register_packet = gen_packet(0, 4, ss_id, Buffer.alloc(0));
                push_data_to_remote(register_packet);
            }else {
                log(ss_id, socket._localAddress, socket._localPort, 0, "closed !");
                //unlinkSync(`./log/${ss_id}.[${socket._localAddress}:${socket._localPort}]`);
            }

            socket.removeAllListeners();
            sessions.delete(ss_id);

        }).on('error', (err) => {
            log(ss_id, socket.localAddress, socket.localPort, 0, `ERROR: ${err}`);
        })
        .on("end", () => {
            let cur = socket._send_handle();
            log(ss_id, socket.localAddress, socket.localPort, cur, "recive FIN from SERVER");

            //流半关
            let register_packet = gen_packet(cur, 5, ss_id, Buffer.alloc(0));
            push_data_to_remote(register_packet);
        }).on("drain", () => {
            //let cur = mapper[remote_port].sh();
            //push_data_to_remote(mix(Buffer.from("PTCTN"), cur, remote_port));
            //mapper[remote_port].drained = false;
        })
    }else {
        //非正常现象，二次创建未释放
        let auth_success = gen_packet(0, 2, ss_id, Buffer.alloc(0));
        push_data_to_remote(auth_success);
    }
}

function on_tunnel_data_recive(packet_number, ss_id, data) {
    if(sessions.has(ss_id)) {   
        let socket = sessions.get(ss_id);
        socket._recv_handle(packet_number, data);
    }else {
        //不存在该会话
    }

    // console.log("<<<<<<", remote_port, packet_number, data);
    //if(data.length == 5 && packet_number == -1) {
        //let cmd = data.toString();

        //if(cmd == "POPEN") {
            //let socket = net.createConnection({host, port, allowHalfOpen: true}, () => {
                //let cur = mapper[remote_port].sh();
                //push_data_to_remote(mix(Buffer.from("POPEN"), cur, remote_port));
            //});

            //mapper[remote_port] = {s:socket, sh:st(), rh:ph(on_port_relay_data_recive, remote_port), drained: false};

            //socket.on('data', (data) => {
                //let cur = mapper[remote_port].sh();

                //// console.log(">>>", remote_port, cur, data.length);

                //push_data_to_remote(mix(Buffer.from(data), cur, remote_port));
            //}).on("close", (hadError) => {
                //if(hadError) {
                    //console.log("closed unexpected !")

                    //let cur = mapper[remote_port].sh();
                    //push_data_to_remote(mix(Buffer.from("PTCLS"), cur, remote_port));
                //} else {
                    //let cur = mapper[remote_port].sh();
                    //push_data_to_remote(mix(Buffer.from("PHALF"), cur, remote_port));
                //}

                //console.log(remote_port, "close port !");

                //mapper[remote_port].rh = undefined;
                //mapper[remote_port].sh = undefined;
                //mapper[remote_port] = undefined;
            //}).on('error', () => {})
            //.on("end", () => {
                //let cur = mapper[remote_port].sh();
                //push_data_to_remote(mix(Buffer.from("PHALF"), cur, remote_port));
            //}).on("drain", () => {
                //let cur = mapper[remote_port].sh();
                //push_data_to_remote(mix(Buffer.from("PTCTN"), cur, remote_port));
                //mapper[remote_port].drained = false;
            //})
            //return;
        //}
    //}
    //if(mapper[remote_port] != undefined)
        //mapper[remote_port].rh(packet_number, data);
}

function on_port_relay_data_recive(data, port, packet_number) {
    if(mapper[port] == undefined) {return}

    console.log("<<<", port, packet_number, data);

    if(data.length == 5) {
        let cmd = data.toString();
        // console.log("<<<", port, packet_number, cmd);
        if(cmd == "PTCLS") {
            console.log(port, "force closed !")
            mapper[port].s.resume();
            mapper[port].s.destroy();
            return;
        }else if(cmd == "PHALF") {
            console.log(port, "relay end")
            mapper[port].s.end();
            return;
        }else if(cmd == "PTCTN") {
            mapper[port].s.resume();
            return;
        }else if(cmd == "PTSTP") {
            mapper[port].s.pause();
            return;
        }

    }

    if(mapper[port].s.write(data) == false) {
        if(mapper[port].drained == false) {
            let cur = mapper[port].sh();
            push_data_to_remote(mix(Buffer.from("PTSTP"), cur, port));
            mapper[port].drained = true;
        }
    }
}

function focus_close_session(ss_id) {
    if(sessions.has(ss_id)) {
        let socket = sessions.get(ss_id);

        log(ss_id, socket.localAddress, socket.localPort, 0, `focus close by client`);

        socket.destroy();
        socket.removeAllListeners();
        sessions.delete(ss_id);
    }else {
        //异常情况
    }
}

function session_pause(ss_id) {
    if(sessions.has(ss_id)) {
        let socket = sessions.get(ss_id);

        log(ss_id, socket.localAddress, socket.localPort, 0, `session pause by client`);
        socket.pause();
    }else {
        //异常情况
    }
}

function session_resume(ss_id) {
    if(sessions.has(ss_id)) {
        let socket = sessions.get(ss_id);

        log(ss_id, socket.localAddress, socket.localPort, 0, `session resume by client`);
        socket.pause();
    }else {
        //异常情况
    }
}
