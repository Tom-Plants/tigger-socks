const { writeFileSync } = require("fs");

function log(ss_id, remote_addr, remote_port, packet_number, other) {
    //writeFileSync(`./log/${ss_id}.[${remote_addr}:${remote_port}]`, `[${new Date().toISOString()}] -- ${packet_number} : ${other} \n`, {flag: "a+"});
}
module.exports = {log}
