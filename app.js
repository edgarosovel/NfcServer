const CONFIG = require('./config');
const request = require('request');
const fs = require('fs');
const https = require('https');
const mqtt = require('replyer');
const client  = mqtt.connect(CONFIG.URLbroker);
const WebSocket = require('ws');
const server = https.createServer({
	cert: fs.readFileSync('/etc/letsencrypt/live/portalinformatica.uaq.mx/cert.pem'),
	key: fs.readFileSync('/etc/letsencrypt/live/portalinformatica.uaq.mx/privkey.pem'),
}).listen(8080);
const socket = new WebSocket.Server({ server });
const conexiones = {};
 
client.on('connect', function () {
  console.log('Conectado al broker');
});

client.on('close', function () {
  console.log('Desconectado de broker');
});
 
client.on('RFID/#', function (datos, topico) {
  var direccionMAC
  [,direccionMAC] = topico.split('/');
  request.post({
    headers: {'content-type' : 'application/x-www-form-urlencoded'},
    url:     CONFIG.URLportalRFID + 'obtenerFuncionRFID',
    form:    { MAC:direccionMAC, datos:datos }
  }, function(error, response, body){
    if (error){
      console.log(error);
      return;
    }
    try{
      res = JSON.parse(body);
    }catch(e){
      console.log("Error al convertir a JSON la respuesta. Probablemente el portal está caído.")
      return;
    }
    if (res){   //Si el RFID NO tiene una función asignada en el portal, res es nulo
      if(res.usaSockets && res.usaSockets=='1'){
        mandarDatosASocket(direccionMAC, datos);
        if (!res.response || res.response==null) res.response = 1;
      }
      client.reply(`RFIDCB/${direccionMAC}`, res.response);
    }
  });
});

client.on('registro/#', function (data, topic) {
  var direccionMAC
  [,direccionMAC] = topic.split('/');
  if (!direccionMAC) return;
  request.post({
    headers: {'content-type' : 'application/x-www-form-urlencoded'},
    url:     CONFIG.URLportalRFID + 'verificacionRFID',
    form:    {MAC:direccionMAC}
  }, function(error, response, body){
    if (error) {
      console.log(error);
      return;
    }
    try{
      res = JSON.parse(body);
    }catch(e){
      console.log("Error al convertir a JSON la respuesta. Probablemente el portal está caído.")
      return;
    }
    client.reply(`RFIDCB/${direccionMAC}`, res) //CB = callbacks
  });
});

function mandarDatosASocket(direccionMAC, datos){
  if(!(direccionMAC in conexiones)) return; // Si nadie ha selecccionado el modulo para usarlo, regresa
  // se envía un arreglo. [0] es la opcion y [1] el contenido
  conexiones[direccionMAC].send('UID,'+datos,(error)=>{
    if (error) console.log(error);
  });
}

// SOCKETS
socket.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    message = message.split(",");
    // message es un arreglo. [0] es la opcion y [1] el contenido
    switch (message[0]) {
      case 'seleccionModulo':
        // El contenido del mensaje debe de contener la direccion MAC de donde se quiera escuchar
        if(conexiones[message[1]]){  //Si alguien ya tiene el modulo en uso, lo regresa
          ws.send("conexion,0");
          return;
        }
        conexiones[message[1]] = ws; //Se guarda el modulo seleccionado en la tabla
        ws.MAC = message[1];
        ws.send("conexion,1");
        break;
      case 'identificacionModulo':
      // message[1] contiene la direccion MAC del modulo a identificar
      client.reply(`RFIDCB/${message[1]}`, 1);  
      default:
        break;
    }
  });
  ws.on('close', function close() {
    delete conexiones[ws.MAC];
  });
  ws.isAlive = true;
  ws.on('pong', function () { this.isAlive = true} );
});

// REVISA CADA TREINTA SEGUNDOS SI SE CERRÓ ALGUNA ONEXION/SOCKET
const interval = setInterval(function ping() {
  for (var ws of socket.clients){
    if (ws.isAlive == false) {
      ws.terminate();
      delete conexiones[ws.MAC];
      return;
    }
    ws.isAlive = false;
    ws.ping(function(){});
  }
}, 30000);
