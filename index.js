var http = require('http'),
    httpProxy = require('http-proxy');
var request = require('request'); 
var dotenv = require('dotenv');
var protobuf = require("protobufjs");
var read = require('file-reader');
var read = require('read-file');
var crypto = require('crypto');
var Buffer = require('buffer/').Buffer
const NodeRSA = require('node-rsa');
const fetch = require("node-fetch");

// configure the application
dotenv.config();

//
// Create a proxy server with custom application logic
//
var proxy = httpProxy.createProxyServer({});
var keyFile = read.sync(process.env.KETO_KEY);
console.log(`KEY = \n${keyFile}`)
key = new NodeRSA(keyFile,{"signingScheme":"pkcs1-sha256"})

// Obtain a message type
console.log("Account %o",process.env.KETO_ACCOUNT)
let clientHash = Buffer.from(process.env.KETO_ACCOUNT, 'hex');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
let sessionHashHex = null;

async function authenticate() {
  try {
    let protoRef = protobuf.load(process.env.HAND_SHAKE);
    let root = await protoRef; 

    let clientHello = root.lookupType("keto.proto.ClientHello");
    let clientResponse = root.lookupType("keto.proto.ClientResponse");
    let payload = { 
      "version": 1,
      "clientHash": clientHash,
      "signature": key.sign(process.env.KETO_ACCOUNT,"buffer","hex")
    };

    let helloMessage = clientHello.create(payload);
    let messageBuffer = clientHello.encode(helloMessage).finish();

    let handShake = await fetch(`${process.env.KETO_SERVER}hand_shake`, { 
      method: 'POST', 
      body: messageBuffer,
      headers: { 'Content-Type': 'application/protobuf' },
      rejectUnauthorized: false
    })

    if (!handShake.ok) {
      console.log("Failed to authenticate %s", handShake.statusText);
      return;
    }

    let body = await handShake.buffer();
    var responseMessage = clientResponse.decode(body);
    var responseObject = clientResponse.toObject(responseMessage);
    //console.log("The response objects is %o",responseObject)
    var hashBuffer = responseObject.sessionHash
    sessionHashHex = hashBuffer.toString("hex");
    //console.log("Session hash is %s",sessionHashHex)
  } catch(error) {
    console.log(`Failed to authenticate [${error}] reschedule a retry.`);
    setTimeout(function () {
      authenticate();
    }, (10000 * 30));
  }
}

authenticate()

proxy.on('proxyReq', function(proxyReq, req, res, options) {
  console.log("set the session header %s",sessionHashHex);

  proxyReq.setHeader('session_hash', sessionHashHex);

  authenticate()

})

//
// Create your custom server and just call `proxy.web()` to proxy
// a web request to the target passed in the options
// also you can use `proxy.ws()` to proxy a websockets request
//
http.createServer(function(req, res) {
  //setTimeout(function () {
    proxy.web(req, res, {
      target: `${process.env.KETO_SERVER}`,
      secure: false
    });
  //}, 500);

}).listen(5050);
 
console.log("listening on port 5050")
