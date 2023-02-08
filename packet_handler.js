const MAX_PACKET_NUM = 1000000;
function pk_handle(callback, ss_id) {
    let cb = callback;
    let recv_count = 0;
    let buffer = {};
    let rp = ss_id;
    return (pkt_num, data) => {
        if(pkt_num == recv_count) {
            cb(data, rp, recv_count);
			buffer[recv_count] = undefined;
			delete buffer[recv_count];

            while(true) {
                if(buffer[recv_count+1] != undefined) {
                    cb(buffer[recv_count+1], rp, recv_count+1);
                    buffer[recv_count+1] = undefined;
                    delete buffer[recv_count+1];
					recv_count += 1;
                }else break;
            }
			recv_count += 1;
			if(recv_count == MAX_PACKET_NUM) {
				recv_count = 0;
			}
        }else {
			if(pkt_num >= MAX_PACKET_NUM) {
				process.exit(0);
			}
            buffer[pkt_num] = data;
        }

    }
}

function st_handle() {
    let send_count = 0;
    return () => {
        if(send_count == MAX_PACKET_NUM) {
            send_count = 0;
        }
        return send_count++;
    }
}

/**
 * @deprecated
 * @param {*} data 
 * @param {*} current_packet_num 
 * @param {*} referPort 
 * @returns 
 */
function mix(data, current_packet_num, referPort) {
    let num_buffer = Buffer.allocUnsafe(4);
    num_buffer.writeInt16LE(current_packet_num, 0);
    num_buffer.writeUInt16LE(referPort, 2);

    let length_buffer = Buffer.allocUnsafe(4);

    let g_data = Buffer.concat([num_buffer, data]);

    length_buffer.writeUInt32LE(g_data.length, 0);

    return Buffer.concat([length_buffer, g_data]);
}

/**
 * 组装数据包
 * @param {number} packet_number ss_id relayed number
 * @param {number} type packet_type
 * @param {number} ss_id 
 * @param {Buffer} data
 */
function gen_packet(packet_number, type, ss_id, data) {
    let len_buf = Buffer.allocUnsafe(4);
    let pn_buf = Buffer.allocUnsafe(4);
    let type_buf = Buffer.allocUnsafe(1);
    let ss_id_buf = Buffer.allocUnsafe(32);

    pn_buf.writeUInt32LE(packet_number);
    type_buf.writeUInt8(type);
    ss_id_buf.write(ss_id);

    let g_data = Buffer.concat([pn_buf, type_buf, ss_id_buf, data]);

    len_buf.writeUInt32LE(g_data.length);

    return Buffer.concat([len_buf, g_data]);
}

function get_packet(packet) {
	let pn = packet.readUInt32LE(0);
	let type = packet.readUInt8(4);
	let ss_id = packet.slice(5, 5+32).toString();
	let real_data = packet.slice(5+32);
	return {pn, type, ss_id, real_data};
}

/**
 * 每一条线都需要一个粘包处理器
 * @param {*} callback 
 * @returns 
 */
function recv_handle(callback) {
    let packetData = null;
    let value = (callback == undefined ? () => {} : callback);
    return (data) => {
        let d1 = data;
        if(packetData != null) { d1 = Buffer.concat([packetData, d1]); }
        let packet_length;
        while(true) {
            if(d1.length <= 4)
            {
                packetData = d1;
                break;
            }
            packet_length = d1.readUInt32LE(0);

            if(packet_length == d1.length - 4)
            {
                packetData = null;
                value(d1.slice(4, d1.length));
                break;
            }else {
                if(packet_length > d1.length - 4) //没接收完
                {
                    packetData = d1;
                    break;
                }
                else if(packet_length < d1.length - 4) //接过头了
                {
                    //有可能多次接过头，则循环处理
                    let left = d1.slice(4, packet_length + 4);
                    let right = d1.slice(packet_length + 4, d1.length);

                    value(left);
                    packetData = right;
                    d1 = right;
                }
            }

        }
    };
}

module.exports = {
    recv_handle,
    pk_handle,
    st_handle,
    mix,
    gen_packet,
	get_packet
}
