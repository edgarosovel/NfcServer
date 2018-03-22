const CONFIG = require('./config');
const request = require('request');
const mqtt = require('replyer');
const client  = mqtt.connect(CONFIG.URLbroker);
const WebSocket = require('ws');
const socket = new WebSocket.Server({ port: 8080 });
const conexiones = {};
 
client.on('connect', function () {
  console.log('Conectado al broker');
});
 
client.on('RFID/#', function (datos, topico) {
  var direccionMAC
  [,direccionMAC] = topico.split('/');
  request.post({
    headers: {'content-type' : 'application/x-www-form-urlencoded'},
    url:     CONFIG.URLportalRFID + 'obtenerFuncionRFID',
    form:    { MAC:direccionMAC }
  }, function(error, response, body){
    if (error){
      console.log(error);
      return;
    }
    res = JSON.parse(body);
    if (res){   //Si el RFID NO tiene una función asignada en el portal, res es nulo
      if(res.usaSockets && res.usaSockets=='1'){
        mandarDatosASocket(direccionMAC, datos);
        // modificar res 
      }else{
        APIhandler(direccionMAC, datos); 
        // modificar res 
      }
      client.reply(`registroCB/${direccionMAC}`, 1);
    }
  });
});

function APIhandler (direccionMAC, datos){
  request.post({
    headers: {'content-type' : 'application/x-www-form-urlencoded'},
    url:     CONFIG.URLportalRFID + 'handler',
    form:    { MAC:direccionMAC, datos:datos }
  }, function(error, response, body){
    if (error){
      console.log(error);
      return;
    }
    res = JSON.parse(body);
    client.reply(`RFIDCB/${direccionMAC}`, res); //CB = callbacks
  });
}

client.on('registro/#', function (data, topic) {
  var direccionMAC
  [,direccionMAC] = topic.split('/');
  if (!direccionMAC) return;
  request.post({
    headers: {'content-type' : 'application/x-www-form-urlencoded'},
    url:     CONFIG.URLportalRFID + 'verificacionRFID',
    form:    {MAC:direccionMAC}
  }, function(error, response, body){
    if (error){
      console.log(error);
      return;
    }
    res = JSON.parse(body);
    client.reply(`registroCB/${direccionMAC}`, res) //CB = callbacks
  });
});


function mandarDatosASocket(direccionMAC, datos){
  if(!(direccionMAC in conexiones)) return; // Si nadie ha selecccionado el modulo para usarlo, regresa
  conexiones[direccionMAC].send(datos,(error)=>{
    if (error) console.log(error);
  });
}

// SOCKETS
socket.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    // El mensaje debe de contener la direccion MAC de donde se quiera escuchar
    if(conexiones[message]){  //Si alguien ya tiene el modulo en uso, lo regresa
      ws.send("Conexion0");
      return;
    }
    conexiones[message] = ws; //Se guarda el modulo seleccionado en la tabla
    ws.MAC = message;
    ws.send("Conexion1");
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