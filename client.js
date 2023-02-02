let socks = require("socksv5");

let client = socks.connect({
	host: "google.com",
	port: 80,
	proxyHost: "192.168.123.124",
	proxyPort: 1080,
	auths: [socks.auth.None()]
}, (socket) => {
	socket.write(Buffer.from("hello world"));
});
